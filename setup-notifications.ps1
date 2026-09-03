$ErrorActionPreference = 'Stop'

Write-Host 'Vulithuba email and SMS setup' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Gmail: create a Google App Password at https://myaccount.google.com/apppasswords'
Write-Host 'Twilio: copy your Account SID, Auth Token, and purchased/verified sender number.'
Write-Host ''

$smtpUser = Read-Host 'Gmail address'
$smtpPass = Read-Host 'Gmail App Password'
$smtpPass = $smtpPass -replace '\s', ''
$twilioSid = Read-Host 'Twilio Account SID'
$twilioToken = Read-Host 'Twilio Auth Token'
$twilioFrom = Read-Host 'Twilio sender number, for example +1234567890'

if ([string]::IsNullOrWhiteSpace($smtpUser) -or
    [string]::IsNullOrWhiteSpace($smtpPass) -or
    [string]::IsNullOrWhiteSpace($twilioSid) -or
    [string]::IsNullOrWhiteSpace($twilioToken) -or
    [string]::IsNullOrWhiteSpace($twilioFrom)) {
  throw 'All provider values are required.'
}

$envContent = @"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=$smtpUser
SMTP_PASS=$smtpPass
MAIL_FROM=$smtpUser
MAIL_TO=bulumkojarana@gmail.com

TWILIO_ACCOUNT_SID=$twilioSid
TWILIO_AUTH_TOKEN=$twilioToken
TWILIO_FROM=$twilioFrom
SMS_TO=+27663820665
"@

Set-Content -Path (Join-Path $PSScriptRoot '.env') -Value $envContent -Encoding utf8
Write-Host ''
Write-Host 'Saved provider configuration to .env.' -ForegroundColor Green
Write-Host 'Start the website with: npm start' -ForegroundColor Green
