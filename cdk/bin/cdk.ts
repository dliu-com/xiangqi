#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { XiangqiSiteStack } from '../lib/xiangqi-site-stack';

const app = new App();
new XiangqiSiteStack(app, 'XiangqiSite', {
  tags: { service: 'xiangqi' },
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
});
