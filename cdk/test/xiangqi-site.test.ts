import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CONTENT_SECURITY_POLICY, DOCS_HEALTH_REDIRECT, XiangqiSiteStack } from '../lib/xiangqi-site-stack';

const template = Template.fromStack(new XiangqiSiteStack(new App(), 'TestXiangqi'));

test('static site storage stays private and encrypted', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    VersioningConfiguration: { Status: 'Enabled' },
  });
  template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ SigningBehavior: 'always', SigningProtocol: 'sigv4', OriginAccessControlOriginType: 's3' }),
  });
  template.hasResourceProperties('AWS::S3::BucketPolicy', {
    PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
      Action: 's3:GetObject',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Condition: { StringEquals: { 'AWS:SourceArn': Match.anyValue() } },
    })]) },
  });
});

test('serves only the Xiangqi subdomain over HTTPS, without always-on infrastructure', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html',
      Aliases: [{ 'Fn::Join': ['', ['xiangqi.', { 'Fn::ImportValue': 'MainDomain' }]] }],
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: ['GET', 'HEAD'] }),
      HttpVersion: 'http2and3',
    }),
  });
  template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
    CachePolicyConfig: Match.objectLike({ DefaultTTL: 300, MaxTTL: 86400, MinTTL: 0 }),
  });
  template.resourceCountIs('AWS::Route53::RecordSet', 2);
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 0);
  template.resourceCountIs('AWS::DynamoDB::Table', 1);
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
  template.resourceCountIs('AWS::EC2::Instance', 0);
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
});

test('game persistence is on-demand and requests reach Lambda only through CloudFront', () => {
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    ProvisionedThroughput: Match.absent(),
    PointInTimeRecoverySpecification: Match.absent(),
  });
  template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always' }),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Principal: 'cloudfront.amazonaws.com', Action: 'lambda:InvokeFunctionUrl', SourceArn: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Principal: 'cloudfront.amazonaws.com', Action: 'lambda:InvokeFunction', SourceArn: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({ CacheBehaviors: Match.arrayWith([Match.objectLike({
      PathPattern: 'api/*', CachePolicyId: cloudfrontNoCache(),
    })]) }),
  });
});

test('pages and the API send strict security headers and hide S3 server details', () => {
  template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
    ResponseHeadersPolicyConfig: Match.objectLike({
      SecurityHeadersConfig: Match.objectLike({
        ContentSecurityPolicy: { ContentSecurityPolicy: CONTENT_SECURITY_POLICY, Override: true },
        FrameOptions: { FrameOption: 'DENY', Override: true },
        ContentTypeOptions: { Override: true },
        StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
      }),
      CustomHeadersConfig: { Items: [Match.objectLike({ Header: 'Permissions-Policy' })] },
      RemoveHeadersConfig: { Items: Match.arrayWith([{ Header: 'server' }, { Header: 'x-amz-version-id' }, { Header: 'x-amz-server-side-encryption' }]) },
    }),
  });
  for (const directive of ["script-src 'self'", "frame-ancestors 'none'", "object-src 'none'", 'https://files.dliu.com/dliu.com/ui/']) {
    expect(CONTENT_SECURITY_POLICY).toContain(directive);
  }
  expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe');
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const config = distribution.Properties.DistributionConfig;
  const api = config.CacheBehaviors.find((behavior: any) => behavior.PathPattern === 'api/*');
  expect(api.ResponseHeadersPolicyId).toEqual(config.DefaultCacheBehavior.ResponseHeadersPolicyId);
});

test('a request flood cannot take more than 10 of the account\'s Lambda runs', () => {
  template.hasResourceProperties('AWS::Lambda::Function', { ReservedConcurrentExecutions: 10 });
});

function cloudfrontNoCache() {
  return '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
}

test('the game Lambda role can only write its own logs and read/write its own table', () => {
  const roles = template.findResources('AWS::IAM::Role');
  const gameRole = Object.entries(roles).find(([id]) => id.startsWith('GameHandlerRole'));
  expect(gameRole).toBeDefined();
  expect(gameRole![1].Properties.ManagedPolicyArns).toBeUndefined();
  const policies = Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((policy: any) => policy.Properties.Roles.some((role: any) => role.Ref === gameRole![0]));
  const statements = policies.flatMap((policy: any) => policy.Properties.PolicyDocument.Statement);
  expect(statements.flatMap((statement: any) => [].concat(statement.Action)).sort())
    .toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'logs:CreateLogStream', 'logs:PutLogEvents']);
  for (const statement of statements) {
    expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    expect(JSON.stringify(statement.Action)).not.toContain('*');
  }
  template.hasResourceProperties('AWS::Lambda::Function', {
    Role: { 'Fn::GetAtt': [gameRole![0], 'Arn'] }, ReservedConcurrentExecutions: 10,
  });
});

test('the game table is protected from deletion', () => {
  template.hasResourceProperties('AWS::DynamoDB::Table', { DeletionProtectionEnabled: true, SSESpecification: { SSEEnabled: true } });
});

test('every Lambda, including the certificate helper, logs to a stack log group kept for 90 days', () => {
  const logGroups = template.findResources('AWS::Logs::LogGroup');
  expect(Object.keys(logGroups)).toHaveLength(2);
  for (const group of Object.values(logGroups) as any[]) expect(group.Properties.RetentionInDays).toBe(90);
  const functions = Object.values(template.findResources('AWS::Lambda::Function')) as any[];
  expect(functions).toHaveLength(2);
  for (const fn of functions) expect(Object.keys(logGroups)).toContain(fn.Properties.LoggingConfig?.LogGroup?.Ref);
  template.resourceCountIs('Custom::LogRetention', 0);
});

test('/health is GET/HEAD only, forwards nothing to Lambda and is cached for 60 s', () => {
  template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
    CachePolicyConfig: Match.objectLike({
      DefaultTTL: 60, MaxTTL: 60, MinTTL: 0,
      ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
        HeadersConfig: { HeaderBehavior: 'none' },
        CookiesConfig: { CookieBehavior: 'none' },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
      }),
    }),
  });
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const config = distribution.Properties.DistributionConfig;
  const health = config.CacheBehaviors.find((behavior: any) => behavior.PathPattern === 'health');
  const api = config.CacheBehaviors.find((behavior: any) => behavior.PathPattern === 'api/*');
  expect(health.AllowedMethods).toEqual(['GET', 'HEAD']);
  expect(health.OriginRequestPolicyId).toBeUndefined();
  expect(health.TargetOriginId).toEqual(api.TargetOriginId);
  expect(health.ResponseHeadersPolicyId).toEqual(config.DefaultCacheBehavior.ResponseHeadersPolicyId);
  const policies = template.findResources('AWS::CloudFront::CachePolicy');
  const healthPolicy = policies[health.CachePolicyId.Ref].Properties.CachePolicyConfig;
  expect(healthPolicy.DefaultTTL).toBe(60);
  expect(healthPolicy.ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior).toBe('none');
});

test('the old /docs/health address answers 301 to the Testing tab, and only that exact path', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const config = distribution.Properties.DistributionConfig;
  const redirect = config.CacheBehaviors.find((behavior: any) => behavior.PathPattern === 'docs/health');
  expect(redirect.TargetOriginId).toEqual(config.DefaultCacheBehavior.TargetOriginId);
  expect(redirect.AllowedMethods).toEqual(['GET', 'HEAD']);
  expect(redirect.FunctionAssociations).toEqual([expect.objectContaining({ EventType: 'viewer-request' })]);
  expect(config.CacheBehaviors.some((behavior: any) => behavior.PathPattern.includes('*') && behavior.PathPattern.startsWith('docs'))).toBe(false);
  const result = new Function(`${DOCS_HEALTH_REDIRECT}; return handler({});`)();
  expect(result.statusCode).toBe(301);
  expect(result.headers.location.value).toBe('/docs#health');
  template.hasResourceProperties('AWS::CloudFront::Function', { FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }) });
});

test('static files are cached per ?v= version, and no other query string splits the cache', () => {
  const distribution = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as any;
  const policyId = distribution.Properties.DistributionConfig.DefaultCacheBehavior.CachePolicyId.Ref;
  const policy = template.findResources('AWS::CloudFront::CachePolicy')[policyId].Properties.CachePolicyConfig;
  expect(policy.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig).toEqual({ QueryStringBehavior: 'whitelist', QueryStrings: ['v'] });
  expect(policy.ParametersInCacheKeyAndForwardedToOrigin.CookiesConfig.CookieBehavior).toBe('none');
  expect(policy.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig.HeaderBehavior).toBe('none');
});
