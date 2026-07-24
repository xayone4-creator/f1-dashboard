@echo off
title APEX - F1 25 Dashboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERREUR] Node.js n'est pas installe ou pas trouve dans le PATH.
  echo Installe-le depuis https://nodejs.org ^(version 18 ou plus recente^), puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere installation, ca ne prendra qu'un instant...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERREUR] L'installation a echoue. Verifie ta connexion internet.
    pause
    exit /b 1
  )
)

echo Demarrage du dashboard...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

node server\index.js

echo.
echo Le serveur s'est arrete.
pause
