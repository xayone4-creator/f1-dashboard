@echo off
cd /d "%~dp0"
set VBS=%temp%\apex_shortcut.vbs

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS%"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\APEX Dashboard.lnk" >> "%VBS%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS%"
echo oLink.TargetPath = "%~dp0Lancer le dashboard.bat" >> "%VBS%"
echo oLink.WorkingDirectory = "%~dp0" >> "%VBS%"
echo oLink.Description = "APEX - F1 25 Dashboard" >> "%VBS%"
echo oLink.IconLocation = "shell32.dll,220" >> "%VBS%"
echo oLink.Save >> "%VBS%"

cscript //nologo "%VBS%"
del "%VBS%"

echo.
echo Raccourci "APEX Dashboard" ajoute sur ton bureau.
pause
