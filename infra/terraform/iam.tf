# Execution role: Fargate agent duties only - pull the ECR image, emit logs
# and read the application secret ARNs for container injection.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-api-execution"
  assume_role_policy = jsonencode(local.ecs_tasks_assume)
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "application-secrets"
  role   = aws_iam_role.execution.id
  policy = jsonencode(local.application_secrets_policy)
}

# Task role: separate from execution by design. Container injection uses the
# execution role, so the runtime role starts with no attached permissions and
# is the single future grant point for application AWS calls.
resource "aws_iam_role" "task" {
  name               = "${var.name}-api-task"
  assume_role_policy = jsonencode(local.ecs_tasks_assume)
}

locals {
  ecs_tasks_assume = {
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  }
  application_secrets_policy = {
    Version = "2012-10-17"
    Statement = [{
      Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      Effect   = "Allow"
      Resource = [for s in aws_secretsmanager_secret.application : s.arn]
    }]
  }
}
