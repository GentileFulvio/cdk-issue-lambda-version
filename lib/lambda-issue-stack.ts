import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { RemovalPolicy } from "aws-cdk-lib";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";
import type { FunctionProps, IVersion } from "aws-cdk-lib/aws-lambda";
import {
  Alias,
  Architecture,
  Code,
  Function,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Provider } from "aws-cdk-lib/custom-resources";

/// Available architectures found here:
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights-extension-versions.html
const getLambdaInsightsLayerArn = (architectureName: string): string => {
  if (architectureName === Architecture.ARM_64.name) {
    return "arn:aws:lambda:eu-west-1:580247275435:layer:LambdaInsightsExtension-Arm64:18";
  }

  if (architectureName === Architecture.X86_64.name) {
    return "arn:aws:lambda:eu-west-1:580247275435:layer:LambdaInsightsExtension:51";
  }

  throw new Error(`Unsupported architecture found: [${architectureName}]`);
};

export class ICLambda extends Function {
  alias: Alias;

  constructor(scope: Construct, id: string, functionProperties: FunctionProps) {
    super(scope, id, functionProperties);
    const layerArn = getLambdaInsightsLayerArn(this.architecture.name);
    const lambdaInsightsLayer = LayerVersion.fromLayerVersionArn(
      this,
      `LambdaInsightsLayer`,
      layerArn
    );

    this.addLayers(lambdaInsightsLayer);

    this.role?.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "CloudWatchLambdaInsightsExecutionRolePolicy"
      )
    );

    this.currentVersion.applyRemovalPolicy(
      RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
    );

    new LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${this.functionName}`,
      retention: RetentionDays.TEN_YEARS,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    this.alias = new Alias(this, `Alias`, {
      aliasName: "v0",
      version: this.currentVersion as IVersion,
    });
  }
}

export class LambdaIssueStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const justALambda = new ICLambda(this, "JustALambda", {
      runtime: Runtime.NODEJS_20_X,
      handler: "index.handler",
      architecture: Architecture.X86_64,
      code: Code.fromInline(
        'exports.handler = () => { console.log("Hello, world!"); };'
      ),
    });

    const myCustomResourceLambda = new ICLambda(this, "MigrateToLatestLambda", {
      runtime: Runtime.NODEJS_20_X,
      handler: "index.handler",
      architecture: Architecture.X86_64,
      code: Code.fromInline(
        'exports.handler = () => { console.log("Hello, world!"); };'
      ),
    });

    const migrateToLatestProvider = new Provider(
      this,
      "MigrateToLatestProvider",
      {
        onEventHandler: myCustomResourceLambda,
      }
    );

    new cdk.CustomResource(this, "Custom::DbSchemaMigration", {
      serviceToken: migrateToLatestProvider.serviceToken,
      resourceType: "Custom::DbSchemaMigration",
      properties: {
        migrationDirectoryHash: "<hash-computed-by-dir>",
      },
    });
  }
}
