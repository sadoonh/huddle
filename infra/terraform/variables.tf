variable "project_name" {
  description = "Resource name prefix."
  type        = string
  default     = "nex-standup"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

# --- Existing nex network ---------------------------------------------------
variable "vpc_id" {
  description = "Existing VPC shared with the nex portal."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the Lambda function and RDS instance."
  type        = list(string)
}

# --- API --------------------------------------------------------------------
variable "api_image_uri" {
  description = "ECR image URI for the FastAPI Lambda (linux/amd64)."
  type        = string
  default     = ""
}

variable "cors_origins" {
  description = "Origins allowed to call the API. Restrict to the nex portal in production."
  type        = list(string)
  default     = ["*"]
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

# --- Database ---------------------------------------------------------------
variable "db_name" {
  type    = string
  default = "standup"
}

variable "db_username" {
  type    = string
  default = "standup"
}

variable "db_password" {
  description = "RDS master password. Prefer a Secrets Manager-backed value in real deployments."
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for production."
  type        = bool
  default     = false
}

# --- AI ---------------------------------------------------------------------
variable "ai_provider" {
  description = "mock or bedrock."
  type        = string
  default     = "mock"

  validation {
    condition     = contains(["mock", "bedrock"], var.ai_provider)
    error_message = "ai_provider must be mock or bedrock."
  }
}

variable "bedrock_model_id" {
  type    = string
  default = "anthropic.claude-3-5-sonnet-20241022-v2:0"
}

variable "transcripts_processing_enabled" {
  description = "Keep false: transcript review/processing is retired. Data is retained."
  type        = bool
  default     = false
}

variable "transcript_retention_days" {
  description = "S3 lifecycle expiry for transcripts; align with data governance policy."
  type        = number
  default     = 90
}

# --- Observability ----------------------------------------------------------
variable "alarm_actions" {
  description = "Optional SNS topic ARNs for CloudWatch alarms."
  type        = list(string)
  default     = []
}
