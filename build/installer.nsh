; MIKO NSIS hooks (per-user install, no admin). Included by electron-builder (nsis.include).

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Things MIKO itself may have created when the user asked for them in Help & Setup.
    Delete "$DESKTOP\MIKO.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.pranavsairam.miko"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.MIKO"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MIKO"
    ; Explain what happens to the user's data (not shown for silent / upgrade uninstalls).
    IfSilent +2
    MessageBox MB_OK|MB_ICONINFORMATION "MIKO has been removed.$\r$\n$\r$\nYour MIKO settings and ChatGPT sign-in were kept on this PC, so installing MIKO again picks up where you left off.$\r$\n$\r$\nTo remove them too, delete the MIKO-Beta folder in %APPDATA% (type %APPDATA% in the File Explorer address bar)."
  ${endIf}
!macroend
