@echo off
REM ============================================================
REM  cf-pansou one-click deploy (Windows)
REM  Usage:  deploy.bat <API_TOKEN> [ACCOUNT_ID]
REM ============================================================
setlocal

if "%~1"=="" (
  echo [!] Missing API Token.
  echo     Usage: deploy.bat ^<API_TOKEN^> [ACCOUNT_ID]
  echo     Or set CLOUDFLARE_API_TOKEN in environment.
  exit /b 1
)

set "CLOUDFLARE_API_TOKEN=%~1"
if not "%~2"=="" set "CLOUDFLARE_ACCOUNT_ID=%~2"
if "%CLOUDFLARE_ACCOUNT_ID%"=="" set "CLOUDFLARE_ACCOUNT_ID=a496b2cd4f40a5119f3b860243c4e028"

cd /d "%~dp0"

echo.
echo [1/2] Building worker bundle...
call npm run build
if errorlevel 1 (
  echo [!] Build failed.
  exit /b 1
)

echo.
echo [2/2] Deploying to Cloudflare Workers...
node deploy.mjs "%CLOUDFLARE_API_TOKEN%" "%CLOUDFLARE_ACCOUNT_ID%"

endlocal
