import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { XiangqiSiteStack } from '../lib/xiangqi-site-stack';

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

function cloudfrontNoCache() {
  return '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
}
