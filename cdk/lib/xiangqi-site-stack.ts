import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

// Every log group in the account keeps its logs for 3 months.
export const LOG_RETENTION = logs.RetentionDays.THREE_MONTHS;

export const DOCS_HEALTH_REDIRECT = `function handler() {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: { location: { value: '/docs#health' }, 'cache-control': { value: 'public, max-age=86400' } },
  };
}`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://files.dliu.com/dliu.com/ui/",
  "img-src 'self' https://files.dliu.com/dliu.com/",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export class XiangqiSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const rootDomain = Fn.importValue('MainDomain');
    const domainName = Fn.join('', ['xiangqi.', rootDomain]);
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      zoneName: rootDomain,
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    // Match the existing apps: CloudFront requires its certificate in us-east-1.
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      hostedZone,
      region: 'us-east-1',
    });
    // The certificate's helper Lambda would otherwise log to an unmanaged group without this retention.
    const certificateFunction = certificate.node.findChild('CertificateRequestorFunction') as lambda.Function;
    const certificateLogs = new logs.LogGroup(this, 'CertificateRequestorLogs', { retention: LOG_RETENTION, removalPolicy: RemovalPolicy.DESTROY });
    (certificateFunction.node.defaultChild as lambda.CfnFunction).addPropertyOverride('LoggingConfig', { LogGroup: certificateLogs.logGroupName });

    const cachePolicy = new cloudfront.CachePolicy(this, 'SiteCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.minutes(5),
      // Lets static assets honour s-maxage=86400; HTML is published with no-cache, so it is not held at the edge.
      maxTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // Pages and /api/game share these headers. Scripts come only from this site; the shared dliu.com look only
    // needs its stylesheet folder and logo (https://files.dliu.com/dliu.com/README.md).
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteResponseHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true }],
      },
      // S3 would otherwise reveal its server name, object versions and encryption details.
      removeHeaders: ['server', 'x-amz-version-id', 'x-amz-server-side-encryption'],
    });

    const gameTable = new dynamodb.Table(this, 'GameState', {
      partitionKey: { name: 'gameId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const root = path.join(__dirname, '..', '..');
    // Reuse the exact browser rules, and keep the deployed handler dependency-free.
    const engineSource = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8').replace(/^export /gm, '');
    const serviceSource = fs.readFileSync(path.join(root, 'backend/game-service.js'), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    const handlerSource = fs.readFileSync(path.join(root, 'backend/handler.cjs'), 'utf8');
    const gameLogs = new logs.LogGroup(this, 'GameLogs', { retention: LOG_RETENTION, removalPolicy: RemovalPolicy.DESTROY });
    // Least privilege: write to its own log group and read/write its one table item, nothing else
    // (the default AWSLambdaBasicExecutionRole would allow writing to every log group).
    const gameRole = new iam.Role(this, 'GameHandlerRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    gameLogs.grantWrite(gameRole);
    const gameHandler = new lambda.Function(this, 'GameHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(20),
      memorySize: 256,
      role: gameRole,
      // Caps a request flood so it cannot use up the Lambda concurrency the account's other sites share.
      reservedConcurrentExecutions: 10,
      logGroup: gameLogs,
      environment: { TABLE_NAME: gameTable.tableName, SITE_ORIGIN: Fn.join('', ['https://', domainName]) },
      code: lambda.Code.fromInline([engineSource, serviceSource, handlerSource].join('\n')),
    });
    gameTable.grant(gameHandler, 'dynamodb:GetItem', 'dynamodb:PutItem');
    const functionUrl = gameHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // Central traffic monitoring (dliu-com/traffic-monitor): shared visitor cookie; TrafficMonitor
    // creates this distribution's access-log delivery (CloudFront standard logging v2).
    const visitorIdFunction = cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
      functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
      functionName: 'dliu-visitor-id',
    });
    // Makes CloudFront add CloudFront-Viewer-City so the visitor function can log the city.
    const trafficGeoPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
      this, 'TrafficGeo', Fn.importValue('TrafficGeoOriginRequestPolicyId'));

    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(bucket);
    const apiOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl);
    // The testing page moved into the docs page's Testing tab; the old address points there.
    const docsHealthRedirect = new cloudfront.Function(this, 'DocsHealthRedirect', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Redirects /docs/health to /docs#health',
      code: cloudfront.FunctionCode.fromInline(DOCS_HEALTH_REDIRECT),
    });
    // /health for status.dliu.com: keyed on nothing and kept 60 s, so the Lambda runs at most about once a minute
    // per edge location. With no origin request policy, no cookies, Authorization header or query string reach it.
    const healthCachePolicy = new cloudfront.CachePolicy(this, 'HealthCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(60),
      maxTtl: Duration.seconds(60),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: siteOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy,
        originRequestPolicy: trafficGeoPolicy,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE, function: visitorIdFunction }],
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
        'docs/health': {
          origin: siteOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy,
          responseHeadersPolicy: headers,
          functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: docsHealthRedirect }],
        },
        health: {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: healthCachePolicy,
          responseHeadersPolicy: headers,
        },
      },
      domainNames: [domainName],
      certificate,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
      ],
    });
    // IncludeCookies is the only legacy logging setting v2 honours: it puts the dl_vid cookie in the logs.
    (distribution.node.defaultChild as cloudfront.CfnDistribution)
      .addPropertyOverride('DistributionConfig.Logging', { IncludeCookies: true });

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    gameHandler.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: 'xiangqi', zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, 'SiteAliasIpv6Record', {
      recordName: 'xiangqi', zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'GameTableName', { value: gameTable.tableName });
    new CfnOutput(this, 'GameFunctionName', { value: gameHandler.functionName });
    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'CloudFrontDomainName', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'WebsiteUrl', { value: Fn.join('', ['https://', domainName]) });
  }
}
