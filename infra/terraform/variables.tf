variable "local_emulation" {
  type        = bool
  default     = true
  description = "Use dummy credentials and only the allowlisted emulator endpoint."
}
variable "local_endpoint" {
  type        = string
  default     = "http://floci:4566"
  description = "Docker Floci or loopback endpoint; never an AWS URL."
  validation {
    condition     = can(regex("^http://(floci|localhost|127\\.0\\.0\\.1|host\\.docker\\.internal):[0-9]+$", var.local_endpoint))
    error_message = "Only explicit local HTTP emulator hosts are allowed."
  }
}
variable "allow_aws" {
  type        = bool
  default     = false
  description = "Explicit real-AWS acknowledgement; not approved for this challenge."
  validation {
    condition     = var.local_emulation || (var.allow_aws && can(regex("^[0-9]{12}$", var.aws_account_id)))
    error_message = "AWS mode requires explicit acknowledgement and a 12-digit account ID."
  }
}
variable "aws_account_id" {
  type        = string
  default     = ""
  description = "Expected real account, enforced by provider outside local mode."
}
variable "region" {
  type        = string
  default     = "us-east-1"
  description = "Builder choice; AZs use this region's a/b suffixes."
}
variable "name" {
  type        = string
  default     = "challenge"
  description = "Resource name prefix."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,24}[a-z0-9]$", var.name))
    error_message = "Use 2-26 lowercase alphanumeric/hyphen characters, starting with a letter."
  }
}
variable "protect_database" {
  type        = bool
  default     = false
  description = "Enable deletion protection and a final snapshot; demo defaults permit deletion."
}
