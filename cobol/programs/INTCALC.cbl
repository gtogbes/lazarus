      *================================================================
      * INTCALC - accrue simple interest on loan accounts.
      *
      * Batch program. Reads one fixed-width record per line on stdin,
      * writes one result line per record on stdout.
      *
      * Input record (29 chars):
      *   cols  1-8   ACCT-ID   X(8)
      *   cols  9-20  BALANCE   S9(9)V99  sign leading separate
      *   cols 21-26  RATE      9(2)V9(4) annual rate in percent
      *   cols 27-29  DAYS      9(3)
      *
      * Output record (42 chars):
      *   ACCT-ID, applied rate, interest, new balance,
      *   separated by single spaces.
      *
      * Overdrawn accounts pay a 12.5 point penalty on the rate.
      * Synthetic sample program written for Lazarus.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTCALC.

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
           05 IN-ACCT-ID      PIC X(8).
           05 IN-BALANCE      PIC S9(9)V99 SIGN LEADING SEPARATE.
           05 IN-RATE         PIC 9(2)V9(4).
           05 IN-DAYS         PIC 9(3).

       FD  OUT-FILE.
       01  OUT-REC.
           05 OUT-ACCT-ID     PIC X(8).
           05 FILLER          PIC X VALUE SPACE.
           05 OUT-RATE        PIC 9(2)V9(4).
           05 FILLER          PIC X VALUE SPACE.
           05 OUT-INTEREST    PIC S9(7)V99 SIGN LEADING SEPARATE.
           05 FILLER          PIC X VALUE SPACE.
           05 OUT-NEW-BAL     PIC S9(9)V99 SIGN LEADING SEPARATE.

       WORKING-STORAGE SECTION.
       01  WS-EOF             PIC X VALUE "N".
           88 END-OF-INPUT          VALUE "Y".
       01  WS-RATE            PIC 9(2)V9(4).
       01  WS-INTEREST        PIC S9(7)V99.
       01  WS-NEW-BAL         PIC S9(9)V99.

       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
                OUTPUT OUT-FILE
           PERFORM UNTIL END-OF-INPUT
               READ IN-FILE
                   AT END
                       SET END-OF-INPUT TO TRUE
                   NOT AT END
                       PERFORM ACCRUE-PARA
               END-READ
           END-PERFORM
           CLOSE IN-FILE OUT-FILE
           STOP RUN.

       ACCRUE-PARA.
           IF IN-BALANCE < 0
               COMPUTE WS-RATE = IN-RATE + 12.5
           ELSE
               MOVE IN-RATE TO WS-RATE
           END-IF
           COMPUTE WS-INTEREST ROUNDED =
               IN-BALANCE * WS-RATE / 100 * IN-DAYS / 365
           COMPUTE WS-NEW-BAL = IN-BALANCE + WS-INTEREST
           MOVE SPACES       TO OUT-REC
           MOVE IN-ACCT-ID   TO OUT-ACCT-ID
           MOVE WS-RATE      TO OUT-RATE
           MOVE WS-INTEREST  TO OUT-INTEREST
           MOVE WS-NEW-BAL   TO OUT-NEW-BAL
           WRITE OUT-REC.
