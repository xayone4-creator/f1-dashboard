@echo off
title APEX - Bot Discord
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

if not exist "bot\.env" (
  echo.
  echo [ERREUR] Le fichier bot\.env est manquant.
  echo Copie bot\.env.example vers bot\.env et renseigne ton token Discord.
  echo Voir bot\README.md pour le guide complet.
  echo.
  pause
  exit /b 1
)

echo Demarrage du bot Discord...
node bot\index.js

echo.
echo Le bot s'est arrete.
pause
