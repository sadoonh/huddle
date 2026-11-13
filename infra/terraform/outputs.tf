output "api_url" {
  description = "Base URL of the HTTP API Gateway."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "ecr_repository_url" {
  description = "Push the backend image here."
  value       = aws_ecr_repository.api.repository_url
}

output "database_endpoint" {
  description = "Postgres host:port (private)."
  value       = "${aws_db_instance.main.address}:${aws_db_instance.main.port}"
}

output "database_name" {
  value = aws_db_instance.main.db_name
}

output "transcript_bucket" {
  description = "S3 bucket for authorized Teams transcripts."
  value       = aws_s3_bucket.transcripts.bucket
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "cloudwatch_log_group" {
  value = aws_cloudwatch_log_group.api.name
}

output "transcript_queue_url" {
  description = "SQS queue consumed by the transcript worker."
  value       = aws_sqs_queue.transcripts.id
}

output "transcript_dlq_url" {
  description = "Dead-letter queue for failed transcript jobs."
  value       = aws_sqs_queue.transcripts_dlq.id
}

output "worker_function_name" {
  value = aws_lambda_function.worker.function_name
}
