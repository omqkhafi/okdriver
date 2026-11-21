# Pipelining probes

Each probe ran 5 times per server. Cells: runs meeting the definition of "safe" out of 5, then the observation (identical in every run unless noted).

Safe means: responses in command order; every error belongs to exactly one statement; nothing stalls; nothing is skipped silently (server-side log and table effects match what was sent). Probes marked observation-only (P5b, P8b, P9b, P9c) are never "safe" by construction.

## P1 query batch (50 COM_QUERY in one write)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| my97 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| my2610 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma106 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma1011 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma114 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma118 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma123 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |
| ma130 | 5/5 | inOrder=true serverLogged=50/50 inSentOrder=true |

## P2 execute batch (50 COM_STMT_EXECUTE inserts in one write)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| my97 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| my2610 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma106 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma1011 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma114 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma118 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma123 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |
| ma130 | 5/5 | allOk=true rowsInserted=50/50 serverOrderMatches=true |

## P3 error in the middle (COM_QUERY, #10 of 20 fails)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| my97 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| my2610 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma106 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma1011 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma114 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma118 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma123 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |
| ma130 | 5/5 | errorOnlyAtIndex10=true serverLogged=20/20 connectionUsableAfter=true |

## P4 error in the middle (COM_STMT_EXECUTE, duplicate key at #5 of 8)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| my97 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| my2610 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma106 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma1011 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma114 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma118 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma123 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |
| ma130 | 5/5 | errorOnlyAtIndex5=true rowsInTable=7/7 |

## P5 prepare + execute(0xFFFFFFFF) without waiting

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | responses=PREPARE,ERR1243 value=null connectionUsableAfter=true |
| my97 | 0/5 | responses=PREPARE,ERR1243 value=null connectionUsableAfter=true |
| my2610 | 0/5 | responses=PREPARE,ERR1243 value=null connectionUsableAfter=true |
| ma106 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |
| ma1011 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |
| ma114 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |
| ma118 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |
| ma123 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |
| ma130 | 5/5 | responses=PREPARE,ROWS1 value=42 connectionUsableAfter=true |

## P5b prepare + execute with a guessed next statement id

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | firstId=1 guess=2 assignedId=2 guessMatches=true responses=PREPARE,ROWS1 |
| my97 | 0/5 | firstId=1 guess=2 assignedId=2 guessMatches=true responses=PREPARE,ROWS1 |
| my2610 | 0/5 | firstId=1 guess=2 assignedId=2 guessMatches=true responses=PREPARE,ROWS1 |
| ma106 | 0/5 | firstId=9 guess=10 assignedId=10 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |
| ma1011 | 0/5 | firstId=8 guess=9 assignedId=9 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |
| ma114 | 0/5 | firstId=9 guess=10 assignedId=10 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |
| ma118 | 0/5 | firstId=11 guess=12 assignedId=12 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |
| ma123 | 0/5 | firstId=9 guess=10 assignedId=10 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |
| ma130 | 0/5 | firstId=9 guess=10 assignedId=10 guessMatches=true responses=PREPARE,ROWS1 (+4 run-to-run variants, e.g. timings or statement ids) |

## P6 failing prepare then execute(0xFFFFFFFF)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| my97 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| my2610 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma106 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma1011 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma114 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma118 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma123 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |
| ma130 | 5/5 | responses=ERR1064,ERR1243 errnos=1064/1243 connectionUsableAfter=true |

## P7 large result in the middle, slow reader (3 commands, 20 MB middle result)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | inOrder=true bigRows=20000 |
| my97 | 5/5 | inOrder=true bigRows=20000 |
| my2610 | 5/5 | inOrder=true bigRows=20000 |
| ma106 | 5/5 | inOrder=true bigRows=20000 |
| ma1011 | 5/5 | inOrder=true bigRows=20000 |
| ma114 | 5/5 | inOrder=true bigRows=20000 |
| ma118 | 5/5 | inOrder=true bigRows=20000 |
| ma123 | 5/5 | inOrder=true bigRows=20000 |
| ma130 | 5/5 | inOrder=true bigRows=20000 |

## P8 stall: client stops reading and keeps writing (24 MB of filler behind a 20 MB result)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Sending to client" clientWriteCallbackFired=false recoveredAfterResume=true (+1 run-to-run variants, e.g. timings or statement ids) |
| my97 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Sending to client" clientWriteCallbackFired=false recoveredAfterResume=true |
| my2610 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Sending to client" clientWriteCallbackFired=false recoveredAfterResume=true (+1 run-to-run variants, e.g. timings or statement ids) |
| ma106 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true (+1 run-to-run variants, e.g. timings or statement ids) |
| ma1011 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true |
| ma114 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true |
| ma118 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true |
| ma123 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true |
| ma130 | 5/5 | serverStartedFillersAt8sWhileClientNotReading=0/1500 serverStalled=true serverState="Writing to net" clientWriteCallbackFired=false recoveredAfterResume=true (+1 run-to-run variants, e.g. timings or statement ids) |

## P8b server gives up on a reader that stops (net_write_timeout=2 s, reader paused 6 s)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| my97 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| my2610 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma106 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma1011 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma114 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma118 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma123 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |
| ma130 | 0/5 | responsesReceived=ROWS1,LOST:connection closed statementsServerLogged=2/3 |

## P9a bulk execute: 100 rows in one COM_STMT_BULK_EXECUTE (0xFA)

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | response=ERR1047 Unknown command rowsInTable=0/100 connectionUsableAfter=true |
| my97 | 0/5 | response=ERR1047 Unknown command rowsInTable=0/100 connectionUsableAfter=true |
| my2610 | 0/5 | response=ERR1047 Unknown command rowsInTable=0/100 connectionUsableAfter=true |
| ma106 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |
| ma1011 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |
| ma114 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |
| ma118 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |
| ma123 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |
| ma130 | 5/5 | response=OK affected=100 rowsInTable=100/100 connectionUsableAfter=true |

## P9b bulk execute with a duplicate key at row 50 of 100

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | response=ERR1047 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| my97 | 0/5 | response=ERR1047 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| my2610 | 0/5 | response=ERR1047 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma106 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma1011 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma114 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma118 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma123 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |
| ma130 | 0/5 | response=ERR1062 rowsInTableAfter=1 (1 pre-existing; 100 sent, row 50 duplicates it) |

## P9c prepare + bulk execute(0xFFFFFFFF) without waiting

| server | safe runs | observation |
| --- | --- | --- |
| my84 | 0/5 | responses=PREPARE,ERR1047 rowsInTable=0/10 |
| my97 | 0/5 | responses=PREPARE,ERR1047 rowsInTable=0/10 |
| my2610 | 0/5 | responses=PREPARE,ERR1047 rowsInTable=0/10 |
| ma106 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
| ma1011 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
| ma114 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
| ma118 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
| ma123 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
| ma130 | 0/5 | responses=PREPARE,OK rowsInTable=10/10 |
