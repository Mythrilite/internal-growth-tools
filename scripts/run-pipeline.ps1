# Daily Lead Generation Pipeline Runner
# This script can be scheduled with Windows Task Scheduler to run at 7am ET daily

param(
    [switch]$Test = $false
)

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$PipelineScript = Join-Path $ScriptDir "pipeline\daily_lead_pipeline.py"
$LogDir = Join-Path $ProjectDir "logs"
$LogFile = Join-Path $LogDir "pipeline_$(Get-Date -Format 'yyyy-MM-dd').log"

# Ensure log directory exists
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Start logging
$StartTime = Get-Date
"=" * 60 | Out-File -FilePath $LogFile -Append
"Pipeline Started: $StartTime" | Out-File -FilePath $LogFile -Append
"Test Mode: $Test" | Out-File -FilePath $LogFile -Append
"=" * 60 | Out-File -FilePath $LogFile -Append

try {
    # Change to project directory
    Set-Location $ProjectDir

    # Build the command
    $Arguments = @($PipelineScript)
    if ($Test) {
        $Arguments += "--test"
    }

    # Run the pipeline
    Write-Host "Starting Daily Lead Pipeline..."
    Write-Host "Log file: $LogFile"

    $Process = Start-Process -FilePath "python" `
        -ArgumentList $Arguments `
        -NoNewWindow `
        -Wait `
        -PassThru `
        -RedirectStandardOutput "$LogFile.stdout" `
        -RedirectStandardError "$LogFile.stderr"

    # Append stdout and stderr to main log
    if (Test-Path "$LogFile.stdout") {
        Get-Content "$LogFile.stdout" | Out-File -FilePath $LogFile -Append
        Remove-Item "$LogFile.stdout" -Force
    }
    if (Test-Path "$LogFile.stderr") {
        "STDERR:" | Out-File -FilePath $LogFile -Append
        Get-Content "$LogFile.stderr" | Out-File -FilePath $LogFile -Append
        Remove-Item "$LogFile.stderr" -Force
    }

    $ExitCode = $Process.ExitCode
    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime

    "=" * 60 | Out-File -FilePath $LogFile -Append
    "Pipeline Completed: $EndTime" | Out-File -FilePath $LogFile -Append
    "Duration: $($Duration.TotalMinutes.ToString('F1')) minutes" | Out-File -FilePath $LogFile -Append
    "Exit Code: $ExitCode" | Out-File -FilePath $LogFile -Append
    "=" * 60 | Out-File -FilePath $LogFile -Append

    if ($ExitCode -eq 0) {
        Write-Host "Pipeline completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "Pipeline failed with exit code $ExitCode" -ForegroundColor Red
    }

    exit $ExitCode
}
catch {
    $ErrorMessage = $_.Exception.Message
    "ERROR: $ErrorMessage" | Out-File -FilePath $LogFile -Append
    Write-Host "Pipeline error: $ErrorMessage" -ForegroundColor Red
    exit 1
}
