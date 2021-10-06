import * as cdk from '@aws-cdk/core';
import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import eks = require('@aws-cdk/aws-eks');
import { ClusterAutoscaler } from './addons/cluster-autoscaler';
import { FluxV2 } from './addons/fluxv2';
import { AWSLoadBalancerController } from './addons/aws-lbc';

export class InfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    
    const repoUrl = new cdk.CfnParameter(this, 'FluxRepoURL', {
      type: 'String',
      description: "The URL to the git repository to use for Flux"
    });
    const repoBranch = new cdk.CfnParameter(this, 'FluxRepoBranch', {
      type: 'String',
      description: "Branch to use from the repository",
      default: "main"
    });
    const repoPath = new cdk.CfnParameter(this, 'FluxRepoPath', {
      type: 'String',
      description: 'Which path to start the sync from'
    });
    /*const repoUrl = 'ssh://git@github.com:davidsaal1/aws-cdk-eks-fluxv2-example';
    const repoBranch = 'main';
    const repoPath = './k8s-config/clusters/demo';*/

    // A VPC, including NAT GWs, IGWs, where we will run our cluster
    const vpc = new ec2.Vpc(this, 'VPC', {});

    // The IAM role that will be used by EKS
    const clusterRole = new iam.Role(this, 'ClusterRole', {
      assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSVPCResourceController')
      ]
    });

    // The EKS cluster, without worker nodes as we'll add them later
    const cluster = new eks.Cluster(this, 'aaodCluster', {
      vpc: vpc,
      role: clusterRole,
      version: eks.KubernetesVersion.V1_20,
      defaultCapacity: 0
    });
    
    // Adding roles for better experience (Internal, Cloud9)
    const roleInternal = iam.Role.fromRoleArn(this,'InternaldRole','arn:aws:iam::466309083827:role/Admin');
    // associating to id mapping
    cluster.awsAuth.addMastersRole(roleInternal);
    const roleC9 = iam.Role.fromRoleArn(this,'Cloud9Role','arn:aws:iam::466309083827:role/mycloud9-role');
    // associating to id mapping
    cluster.awsAuth.addMastersRole(roleC9);

    // Worker node IAM role
    const workerRole = new iam.Role(this, 'WorkerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSVPCResourceController') // Allows us to use Security Groups for pods
      ]
    });

    // Select the private subnets created in our VPC and place our worker nodes there
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE
    });
    
    // Select the private subnets created in our VPC and place our worker nodes there
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC
    });

    // Adding Node Group - On Demand
    cluster.addNodegroupCapacity('dev-2vcpu-8gb-ondemand', {
      subnets: privateSubnets,
      nodeRole: workerRole,
      minSize: 2,
      desiredSize: 2,
      maxSize: 2,
      capacityType: eks.CapacityType.ON_DEMAND,
      labels: { intent: 'control-apps' }
    });
    
    
    // Creating managed nodegroup with Spot Capacity
    cluster.addNodegroupCapacity('dev-4vcpu-16gb-spot', {
      instanceTypes: [
        new ec2.InstanceType("m4.xlarge"),
        new ec2.InstanceType("m5.xlarge"),
        new ec2.InstanceType("m5a.xlarge"),
        new ec2.InstanceType("m5ad.xlarge"),
        new ec2.InstanceType("m5d.xlarge"),
        new ec2.InstanceType("m6i.xlarge"),
        new ec2.InstanceType("t2.xlarge"),
        new ec2.InstanceType("t3.xlarge"),
      ],
      subnets: publicSubnets,
      nodeRole: workerRole,
      minSize: 2,
      desiredSize: 2,
      maxSize: 5,
      capacityType: eks.CapacityType.SPOT,
      labels: { intent: 'apps' },
    });
    

    // Add our default addons
    new ClusterAutoscaler(this, 'ClusterAutoscaler', {
      cluster: cluster,
    });

    // Add FluxV2
    new FluxV2(this, 'FluxV2', {
      cluster: cluster,
      secretName: 'github-keypair',
      repoUrl: repoUrl.valueAsString,
      repoBranch: repoBranch.valueAsString,
      repoPath: repoPath.valueAsString
    });

    // Add AWS Load Balancer Controller
    new AWSLoadBalancerController(this, 'AWSLoadBalancerController', {
      cluster: cluster,
      namespace: 'kube-system'
    });
  }
}
