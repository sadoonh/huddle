data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Application = "standup-first-work-management"
  }
  cors_origins = length(var.cors_origins) > 0 ? var.cors_origins : ["*"]

  # NOTE: characters that are special in a URL (e.g. @ : / ? #) must be
  # URL-encoded in var.db_password, or replaced with a Secrets Manager lookup
  # inside the application.
  database_url = format(
    "postgresql+psycopg://%s:%s@%s:5432/%s",
    var.db_username,
    var.db_password,
    aws_db_instance.main.address,
    var.db_name,
  )

  bedrock_statements = var.ai_provider == "bedrock" ? [{
    Effect   = "Allow"
    Action   = ["bedrock:InvokeModel"]
    Resource = "*"
  }] : []
}

# ---------------------------------------------------------------------------
# Transcript storage (governed by retention policy)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "transcripts" {
  bucket = "${local.name}-transcripts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "transcripts" {
  bucket                  = aws_s3_bucket.transcripts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    id     = "expire-transcripts"
    status = "Enabled"
    filter {}
    expiration {
      days = var.transcript_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# ---------------------------------------------------------------------------
# Container registry
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "lambda" {
  name        = "${local.name}-lambda"
  description = "Standup API Lambda egress"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Postgres access from the standup API Lambda only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from API Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

resource "aws_db_instance" "main" {
  identifier             = "${local.name}-db"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage
  max_allocated_storage  = var.db_allocated_storage * 5
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  backup_retention_period         = 7
  backup_window                   = "03:00-04:00"
  maintenance_window              = "sun:04:00-sun:05:00"
  auto_minor_version_upgrade      = true
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql"]

  deletion_protection       = var.environment == "prod"
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name}-final" : null
}

# ---------------------------------------------------------------------------
# API Lambda
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.name}-worker"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# Asynchronous transcript reconciliation queue
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "transcripts_dlq" {
  name                      = "${local.name}-transcripts-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "transcripts" {
  name                       = "${local.name}-transcripts"
  message_retention_seconds  = 86400
  visibility_timeout_seconds = 360
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.transcripts_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "api" {
  name = "${local.name}-api"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = [
          "${aws_cloudwatch_log_group.api.arn}:*",
          "${aws_cloudwatch_log_group.worker.arn}:*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = [
          aws_sqs_queue.transcripts.arn,
          aws_sqs_queue.transcripts_dlq.arn,
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.transcripts.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.transcripts.arn
      },
    ], local.bedrock_statements)
  })
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name}-api"
  role          = aws_iam_role.api.arn

  package_type  = "Image"
  image_uri     = var.api_image_uri
  architectures = ["x86_64"]
  memory_size   = 1024
  timeout       = 30

  environment {
    variables = {
      ENVIRONMENT          = var.environment
      AUTH_MODE            = "nex"
      DATABASE_URL         = local.database_url
      CORS_ORIGINS         = join(",", local.cors_origins)
      AI_PROVIDER          = var.ai_provider
      AI_PROCESSING_INLINE = "false"
      BEDROCK_REGION       = var.aws_region
      BEDROCK_MODEL_ID     = var.bedrock_model_id
      TRANSCRIPT_BUCKET    = aws_s3_bucket.transcripts.bucket
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  depends_on = [
    aws_cloudwatch_log_group.api,
    aws_iam_role_policy.api,
  ]
}

resource "aws_lambda_function" "worker" {
  function_name = "${local.name}-worker"
  role          = aws_iam_role.api.arn

  package_type  = "Image"
  image_uri     = var.api_image_uri
  architectures = ["x86_64"]
  memory_size   = 1024
  timeout       = 300

  image_config {
    command = ["app.worker.handler"]
  }

  environment {
    variables = {
      ENVIRONMENT       = var.environment
      AUTH_MODE         = "nex"
      DATABASE_URL      = local.database_url
      AI_PROVIDER       = var.ai_provider
      BEDROCK_REGION    = var.aws_region
      BEDROCK_MODEL_ID  = var.bedrock_model_id
      TRANSCRIPT_BUCKET = aws_s3_bucket.transcripts.bucket
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  depends_on = [
    aws_cloudwatch_log_group.worker,
    aws_iam_role_policy.api,
  ]
}

resource "aws_lambda_event_source_mapping" "transcripts" {
  event_source_arn                   = aws_sqs_queue.transcripts.arn
  function_name                      = aws_lambda_function.worker.arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0

  scaling_config {
    maximum_concurrency = 2
  }
}

# ---------------------------------------------------------------------------
# HTTP API Gateway
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = local.cors_origins
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = [
      "content-type",
      "authorization",
      "x-nex-user-id",
      "x-nex-email",
      "x-nex-name",
      "x-nex-roles",
    ]
    max_age = 3600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-errors"
  alarm_description   = "Standup API Lambda is returning errors."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  alarm_description   = "Postgres CPU above 80% for 10 minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
}
