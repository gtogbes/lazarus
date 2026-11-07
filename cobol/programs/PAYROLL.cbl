      *================================================================
      * PAYROLL - weekly gross-to-net pay.
      *
      * Batch program. One fixed-width record per line on stdin,
      * one result line per record on stdout.
      *
      * Input record (23 chars):
      *   cols  1-6   EMP-ID    X(6)
      *   cols  7-10  HOURS     9(2)V99
      *   cols 11-15  RATE      9(3)V99   hourly rate
      *   cols 16-23  ADJUST    S9(5)V99  sign leading separate
      *
      * Output record (34 chars):
      *   EMP-ID, status (OK or SE = gross too large), gross, tax, net.
      *
      * Hours over 40 are paid at time and a half. Tax bands:
      *   up to 1000.00 nil, to 4000.00 at 25%, above at 45%,
      * rounded to the nearest even penny (banker's rounding).
      * Working storage is packed decimal (COMP-3).
      * Synthetic sample program written for Lazarus.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYROLL.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE  ASSIGN TO KEYBOARD
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT OUT-FILE ASSIGN TO DISPLAY
               ORGANIZATION IS LINE SEQUENTIAL.

       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC.
           05 IN-EMP-ID       PIC X(6).
           05 IN-HOURS        PIC 9(2)V99.
           05 IN-RATE         PIC 9(3)V99.
           05 IN-ADJUST       PIC S9(5)V99 SIGN LEADING SEPARATE.

       FD  OUT-FILE.
       01  OUT-REC.
           05 OUT-EMP-ID      PIC X(6).
           05 FILLER          PIC X.
           05 OUT-STATUS      PIC X(2).
           05 FILLER          PIC X.
           05 OUT-GROSS       PIC 9(5)V99.
           05 FILLER          PIC X.
           05 OUT-TAX         PIC 9(5)V99.
           05 FILLER          PIC X.
           05 OUT-NET         PIC S9(5)V99 SIGN LEADING SEPARATE.

       WORKING-STORAGE SECTION.
       01  WS-EOF             PIC X VALUE "N".
           88 END-OF-INPUT          VALUE "Y".
       01  WS-OT-HOURS        PIC 9(2)V99   COMP-3.
       01  WS-GROSS           PIC 9(5)V99   COMP-3.
       01  WS-TAX             PIC 9(5)V99   COMP-3.
       01  WS-NET             PIC S9(5)V99  COMP-3.

       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
                OUTPUT OUT-FILE
           PERFORM UNTIL END-OF-INPUT
               READ IN-FILE
                   AT END
                       SET END-OF-INPUT TO TRUE
                   NOT AT END
                       PERFORM PAY-PARA
               END-READ
           END-PERFORM
           CLOSE IN-FILE OUT-FILE
           STOP RUN.

       PAY-PARA.
           MOVE SPACES TO OUT-REC
           MOVE "OK"   TO OUT-STATUS
           MOVE ZERO   TO WS-GROSS WS-TAX
           IF IN-HOURS > 40
               COMPUTE WS-OT-HOURS = IN-HOURS - 40
               COMPUTE WS-GROSS ROUNDED =
                   40 * IN-RATE + WS-OT-HOURS * IN-RATE * 1.5
                   ON SIZE ERROR
                       MOVE "SE" TO OUT-STATUS
               END-COMPUTE
           ELSE
               COMPUTE WS-GROSS ROUNDED = IN-HOURS * IN-RATE
           END-IF
           EVALUATE TRUE
               WHEN WS-GROSS <= 1000
                   MOVE ZERO TO WS-TAX
               WHEN WS-GROSS <= 4000
                   COMPUTE WS-TAX ROUNDED MODE NEAREST-EVEN =
                       (WS-GROSS - 1000) * 0.25
               WHEN OTHER
                   COMPUTE WS-TAX ROUNDED MODE NEAREST-EVEN =
                       750 + (WS-GROSS - 4000) * 0.45
           END-EVALUATE
           COMPUTE WS-NET = WS-GROSS - WS-TAX + IN-ADJUST
           MOVE IN-EMP-ID TO OUT-EMP-ID
           MOVE WS-GROSS  TO OUT-GROSS
           MOVE WS-TAX    TO OUT-TAX
           MOVE WS-NET    TO OUT-NET
           WRITE OUT-REC.
