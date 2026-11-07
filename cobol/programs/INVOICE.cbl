      *================================================================
      * INVOICE - price one invoice line with discount and VAT.
      *
      * Batch program. One fixed-width record per line on stdin,
      * one result line per record on stdout.
      *
      * Input record (21 chars):
      *   cols  1-6   INV-ID    X(6)
      *   cols  7-10  QTY       9(4)
      *   cols 11-17  PRICE     9(5)V99   unit price
      *   cols 18-20  DISC-PCT  9(2)V9    discount percent
      *   col  21     VAT-CODE  X         S 17.5%, R 5%, Z 0%
      *
      * Output record (49 chars):
      *   INV-ID, status (OK or VC = unknown VAT code),
      *   line amount, discount, VAT, total.
      *
      * The discount is truncated to the penny; VAT uses banker's
      * rounding. Amounts that overflow 9(7)V99 lose high-order digits.
      * Synthetic sample program written for Lazarus.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVOICE.

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
           05 IN-INV-ID       PIC X(6).
           05 IN-QTY          PIC 9(4).
           05 IN-PRICE        PIC 9(5)V99.
           05 IN-DISC-PCT     PIC 9(2)V9.
           05 IN-VAT-CODE     PIC X.

       FD  OUT-FILE.
       01  OUT-REC.
           05 OUT-INV-ID      PIC X(6).
           05 FILLER          PIC X.
           05 OUT-STATUS      PIC X(2).
           05 FILLER          PIC X.
           05 OUT-LINE        PIC 9(7)V99.
           05 FILLER          PIC X.
           05 OUT-DISC        PIC 9(7)V99.
           05 FILLER          PIC X.
           05 OUT-VAT         PIC 9(7)V99.
           05 FILLER          PIC X.
           05 OUT-TOTAL       PIC 9(7)V99.

       WORKING-STORAGE SECTION.
       01  WS-EOF             PIC X VALUE "N".
           88 END-OF-INPUT          VALUE "Y".
       01  WS-LINE            PIC 9(7)V99.
       01  WS-DISC            PIC 9(7)V99.
       01  WS-NET             PIC 9(7)V99.
       01  WS-VAT-RATE        PIC 9(2)V9.
       01  WS-VAT             PIC 9(7)V99.
       01  WS-TOTAL           PIC 9(7)V99.

       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT IN-FILE
                OUTPUT OUT-FILE
           PERFORM UNTIL END-OF-INPUT
               READ IN-FILE
                   AT END
                       SET END-OF-INPUT TO TRUE
                   NOT AT END
                       PERFORM INV-PARA
               END-READ
           END-PERFORM
           CLOSE IN-FILE OUT-FILE
           STOP RUN.

       INV-PARA.
           MOVE SPACES TO OUT-REC
           MOVE "OK"   TO OUT-STATUS
           COMPUTE WS-LINE = IN-QTY * IN-PRICE
           COMPUTE WS-DISC = WS-LINE * IN-DISC-PCT / 100
           COMPUTE WS-NET  = WS-LINE - WS-DISC
           EVALUATE IN-VAT-CODE
               WHEN "S"
                   MOVE 17.5 TO WS-VAT-RATE
               WHEN "R"
                   MOVE 5    TO WS-VAT-RATE
               WHEN "Z"
                   MOVE ZERO TO WS-VAT-RATE
               WHEN OTHER
                   MOVE ZERO TO WS-VAT-RATE
                   MOVE "VC" TO OUT-STATUS
           END-EVALUATE
           COMPUTE WS-VAT ROUNDED MODE NEAREST-EVEN =
               WS-NET * WS-VAT-RATE / 100
           COMPUTE WS-TOTAL = WS-NET + WS-VAT
           MOVE IN-INV-ID TO OUT-INV-ID
           MOVE WS-LINE   TO OUT-LINE
           MOVE WS-DISC   TO OUT-DISC
           MOVE WS-VAT    TO OUT-VAT
           MOVE WS-TOTAL  TO OUT-TOTAL
           WRITE OUT-REC.
