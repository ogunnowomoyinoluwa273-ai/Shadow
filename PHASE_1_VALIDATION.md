# Phase 1: Pre-deployment validation

Phase 1 must be completed before moving ACE to an always-on host. It verifies that the active Windows copy, not only the sandbox copy, contains the tested implementation and that the live WhatsApp account behaves correctly.

## A. Validate the active Windows project

Run PowerShell from the folder containing `package.json`:

```powershell
npm install
npm ls @whiskeysockets/baileys --depth=0
npm test
```

The dependency must resolve to `7.0.0-rc14` and the tests must pass. Confirm the following files exist:

```powershell
Test-Path .\src\handlers\messageHandler.js
Test-Path .\src\utils\permissions.js
Test-Path .\src\utils\jid.js
Test-Path .\src\services\sudo.js
Test-Path .\data\auth
```

Do not delete or replace `data\auth`. Preserve `data\sudo.json` if it already exists.

## B. Start and observe the connection

```powershell
npm start
```

Confirm that ACE connects without an unexpected QR prompt, or scan a QR only if this active copy has no valid `data\auth`. Record any connection-close or authentication errors from the terminal.

## C. Live owner and authorization checks

From the linked owner account, test `.ping`, `.menu`, `.sudos`, and `.addsudo @user`. From the selected user account, verify that a normal command works. Then run `.delsudo @user` from the owner account and verify that the same user is rejected afterward. Confirm that an unrelated participant receives an unauthorized response and cannot run commands.

## D. Live group-admin checks

In a test group, confirm the linked account appears as a WhatsApp group administrator. From the owner account, test `.admins`, then `.promote @user` or `.demote @user` with a safe test participant. Confirm that the operation either succeeds or reports the actual WhatsApp permission error. Do not use a real participant as a destructive test target without consent.

## Exit criteria

Phase 1 is complete only when the active Windows copy passes local tests, the exact Baileys version is verified, the owner and sudo workflow works live, and the linked account’s bot-admin status is confirmed. For Phase 2, additionally test `.mute`, `.unmute`, `.slowmode 5`, `.slowmode 0`, `.clear` on one replied message, `.warn`, `.stats`, `.reload`, `.disablecmd ping`, and `.enablecmd ping` in a test group. Keep `BROADCAST_GROUPS` empty unless guarded broadcasts are explicitly needed. Only then should deployment planning begin. These checks have not been live-verified from the sandbox; the user must run the Windows and WhatsApp checks.
