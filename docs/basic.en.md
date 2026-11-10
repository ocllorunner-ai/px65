# PX-65 BASIC Manual

[日本語](basic.md) | English

This is the BASIC built into the PX-65 ROM. It supports floating point, trigonometric, exponential and logarithmic functions, string functions, graphics, sound, and saving programs to tape by name.

![The startup screen](basic.png)

- It lives at `$A000-$DFFF` in the ROM (about 14.3KB of the 16KB is used) and uses the BIOS of the monitor (`$E000-$FFFF`)
- It does not reuse any existing BASIC (such as Microsoft BASIC); everything is newly written. Command names and syntax follow well-known BASICs

## Startup and the screen

```
PX-65 BASIC 0.11
30717 BYTES FREE
>
```

- BASIC starts when you turn the power on. The prompt is `>` (the monitor's prompt is `*`)
- A line typed with a line number (0 to 63999) goes into the program. A line without one runs immediately (direct mode). Typing just a line number deletes that line
- A line can be up to 58 characters. ← → move the cursor, and what you type goes in at the cursor. DEL deletes the character before the cursor. ↑ brings back the previous line. RET enters the whole line wherever the cursor is (the same in `EDIT` and `INPUT`)
- Lines you type are not case-sensitive (`print` becomes `PRINT`). Text inside `" "` is kept as typed
- The BREAK key (Esc on a computer) stops a running program (`BREAK IN 120`). It also stops INPUT, the key wait in LIST, and the key wait for RENUM's warnings. While you are typing a line, it cancels the line
- Reset keeps the program (variables are cleared). The emulator's **Keep RAM when powered off** is on from the start, so the program stays when you turn the power off and on, or open the page again (variables are cleared, and a program never resumes from where it was). If you turn it off, the program is cleared every time the power comes on. To erase the program and all variables, press **Clear RAM**
- On the LCD, DEG / RAD show the angle unit, RUN lights while a program is running (including while INPUT waits for you), BUSY lights while the tape is in use, and SHIFT lights while SHIFT is active. This BASIC does not use PRO, CAPS or LOW (it has no separate modes for entering and running programs, no upper/lower case switching, and no battery)

### Typing symbols

With the on-screen keys, press SHIFT, then the key with the symbol printed small in its top-right corner (SHIFT applies to the next key only; uncheck **SHIFT for the next key only** to make it work only while held down). These are the symbols used most in BASIC. On a computer keyboard, just type the symbol.

| Symbol | `:` | `;` | `^` | `"` | `$` | `(` `)` | `<` `>` | `?` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Keys | SHIFT+`×` | SHIFT+`+` | SHIFT+`=` | SHIFT+`2` | SHIFT+`4` | SHIFT+`8` `9` | SHIFT+`,` `.` | SHIFT+`÷` |

## Numbers and expressions

- Numbers are 5-byte floating point (8-bit exponent, 32-bit mantissa). They have about 9.6 significant digits and are shown with up to 9. The range is about ±1.7E38, and the smallest non-zero magnitude is about 2.9E-39 (anything smaller becomes 0)
- Output: `PRINT 1/3` → ` .333333333`, `PRINT 2^40` → ` 1.09951163E+12`, `PRINT .0001` → ` 1E-04`. A number is printed with a sign position in front (a space if positive) and one space after it
- Writing numbers: `123`, `1.5`, `.5`, `1E-3`, `&H7F` (hexadecimal, 0 to FFFF; also accepted in DATA and when typing for INPUT)
- Operators (highest precedence first):

| Precedence | Operators |
| --- | --- |
| 1 | `( )`, functions |
| 2 | `^` (power) |
| 3 | unary `-` |
| 4 | `*` `/` |
| 5 | `+` `-` |
| 6 | `=` `<>` `<` `>` `<=` `>=` (true is -1, false is 0) |
| 7 | `NOT` |
| 8 | `AND` |
| 9 | `OR` |

- `AND`, `OR` and `NOT` convert their operands to integers from -32768 to 65535 and work bit by bit
- `^` with an integer exponent (absolute value up to 32767) is computed by repeated multiplication, so answers that can be represented exactly come out exact (`2^10` is 1024, `(-2)^3` is -8). But when the exponent's absolute value is over 32 and the base is neither an integer nor a power of 2 (0.5, 1024 and so on), repeated multiplication would pile up errors, so it is computed as `EXP(y*LN(ABS(x)))` (made negative if x is negative and the exponent is odd; `1.0001^10000` gives ` 2.71814131`). A non-integer exponent, or an exponent whose absolute value is over 32767, is also computed as `EXP(y*LN(x))`, and a negative x is an error (`(-1)^32768` also gives `?FC ERROR`)
- Strings are joined with `+` and can be compared (`A$<"M"`, in character-code order)

## Variables and arrays

- A name starts with a letter, followed by letters and digits. Only the first two characters count (`COUNT` and `CO` are the same variable). A name that contains a keyword (`TOTAL` contains `TO`) can't be used
- `A` is a number, `A$` is a string (up to 255 characters)
- `DIM A(20)`, `DIM B$(5,5)`. Subscripts start at 0. An array used without `DIM` gets up to 10 in each dimension
- `RUN`, `NEW`, `CLEAR`, `LOAD`, changing a program line, and reset clear all variables
- Entering the monitor with `MON` and coming back with `Q` keeps the variables (they are cleared only if memory changed in the monitor has damaged BASIC's record of how memory is used). FOR and GOSUB in progress are not kept, so `CONT` is not possible

## Commands

Several commands can go on one line, separated by `:`.

### Editing and running programs

| Command | Examples | Description |
| --- | --- | --- |
| NEW | `NEW` | Erases the program and variables |
| LIST | `LIST`, `LIST 100`, `LIST 100-200`, `LIST 100-`, `LIST -200` | Shows the program. When the screen is full it waits for a key (RET, ↓ or space for more; any other key stops) |
| RUN | `RUN`, `RUN 100` | Clears variables and runs |
| CONT | `CONT` | Continues from where STOP or BREAK stopped |
| EDIT | `EDIT 100` | Puts line 100 in the input line. Fix it and press RET to replace the line |
| DELETE | `DELETE 100`, `DELETE 100-200` | Deletes lines |
| RENUM | `RENUM`, `RENUM 100,5`, `RENUM 1000,10,500` | Renumbers lines (see below) |
| CLEAR | `CLEAR` | Clears variables |
| MON | `MON` | Enters the monitor (`Q` in the monitor comes back; the program and variables are kept; CONT is not possible) |
| CALC | `CALC` | Enters calculator mode (see below) |

### RENUM

`RENUM [new start[,step[,old start]]]` renumbers the lines from the old start onward, beginning at the new start and counting up by step. The defaults are `10,10,0` (every line, from 10 in steps of 10). To skip an argument, write just the comma (`RENUM ,,500` renumbers lines from 500 on, starting at 10 in steps of 10 — an error if that would put them out of order with the earlier lines).

```
>LIST
5 INPUT N
7 IF N<0 THEN 5 ELSE GOSUB 12
9 GOTO 5
12 PRINT SQR(N):RETURN
>RENUM 100,10
>LIST
100 INPUT N
110 IF N<0 THEN 100 ELSE GOSUB 130
120 GOTO 100
130 PRINT SQR(N):RETURN
```

- Line numbers after `GOTO`, `GOSUB`, `THEN`, `ELSE`, `RUN` and `RESTORE`, and in the lists of `ON … GOTO` / `ON … GOSUB`, are changed to the new numbers. Text inside `" "`, and inside `REM` and `DATA`, is not changed
- A reference to a line that doesn't exist (such as `GOTO 999` with no line 999) is left as it is and reported as `UNDEF 999 IN 30`. `999` is the number as written, and `30` is the new number of the line containing it. References to existing lines before the old start are left unchanged without a message
- If the warnings don't fit on the screen, RENUM shows three lines and waits for a key. RET, ↓ or space shows more; any other key skips the rest of the warnings and goes on renumbering. Pressing BREAK during this key wait cancels RENUM without changing anything
- If there are three warnings or fewer, RENUM goes on without waiting (there is no chance to cancel). Read the warnings afterwards and fix the references

```
>RENUM
UNDEF 999 IN 30
>
```

- If renumbering would put lines out of order with earlier lines, a number would exceed 63999, or the step is 0, nothing is changed and you get `?FC ERROR`
- If the line numbers get longer and the program no longer fits in memory, nothing is changed and you get `?OM ERROR`. RENUM needs 2 bytes of free memory per line it renumbers
- Variables are cleared after renumbering. When used inside a program, RENUM stops the program after renumbering
- Line numbers after `LIST`, `EDIT` and `DELETE` written inside a program are not changed
- Typical time: about 0.7 seconds for 100 lines, about 4 seconds for 500 lines

LIST shows `?` as `PRINT` and `'` as `REM`. Lines typed without spaces are shown with spaces added around keywords for readability (`?1` becomes `PRINT 1`, `IFA>0THEN100` becomes `IF A>0 THEN 100`). A function and its `(`, as in `SIN(1)`, stay together. The program itself is not changed.

EDIT puts the line in the input line the same way. However, if adding the spaces would make the line longer than 58 characters, it is shown as typed (without the added spaces). If you press RET on the spaced version, the spaces become part of the program.

### CALC (calculator mode)

Type `CALC` to enter calculator mode. The prompt changes from `>` to `C>`. In calculator mode, type an expression and press RET to see the answer (no `PRINT` needed).

```
>CALC
C>1+2
 3
C>R=5
C>PI*R^2
 78.5398163
C>DEG
C>SIN(30)
 .5
```

In calculator mode, a line is handled like this:

| Line | What happens | Examples |
| --- | --- | --- |
| An expression | Shows its value (the same way as `PRINT`) | `1+2`, `SQR(2)`, `-5*3`, `"AB"+"C"` |
| Starts with a number | An expression. You can't type program lines in calculator mode | `100/7` |
| `variable=expression` | Assigns (shows nothing) | `R=5`, `A(3)=7`, `A$="X"` |
| Starts with a command | Runs as in normal direct mode | `DEG`, `?1;2`, `LIST`, `RUN` |
| An empty line | Does nothing | |

- To test whether two values are equal, put the comparison in parentheses, as in `(A=5)` (`A=5` is an assignment). `A<5` and the like can be written as they are
- Only the first statement on a line is treated as an expression. For an expression after `:`, add `?` (PRINT), as in `A=2:?A+3` or `1+2:?3+4`
- A line fixed with `EDIT` is handled as a normal line even in calculator mode (with a line number it goes into the program; if you delete the line number, it runs as a normal direct command). Afterwards you are back at `C>`. Pressing BREAK while editing cancels the edit and returns to `C>` (calculator mode does not end)
- An error keeps you in calculator mode. If you `RUN` a program, you come back to `C>` when it ends
- Pressing BREAK (Esc on a computer) while `C>` is waiting for input ends calculator mode and returns to `>`. BREAK while a program is running stops the program and returns to `C>`
- Reset, turning the power off and on, and coming back from `MON` with `Q` also end calculator mode
- To use a previous answer, store it in a variable, as in `X=expression`
- `CALC` written in a program turns on calculator mode after the program ends

### Flow

| Command | Examples | Description |
| --- | --- | --- |
| END / STOP | | End / stop (STOP shows `BREAK IN 100`; CONT continues) |
| REM / `'` | `REM note`, `' note` | Comment (to the end of the line) |
| GOTO / GOSUB / RETURN | `GOTO 100`, `GOSUB 1000` | Jump, subroutine |
| ON | `ON N GOTO 100,200,300` | Chooses a destination by the value of N (1, 2, …). The fraction of N is dropped (-0.5 becomes 0). If N is 0 or larger than the number of destinations, goes on to the next statement. If N is negative or 256 or more after dropping the fraction, you get `?FC ERROR`. GOSUB also works |
| IF | `IF A>0 THEN 100`, `IF A THEN PRINT A ELSE PRINT "NO"`, `IF A>0 GOTO 100` | Condition. After THEN, a line number or statements. If false, goes to what follows ELSE (or the next line if there is no ELSE). When an IF contains another IF, each ELSE belongs to the nearest IF that has no ELSE yet (in `IF A THEN IF B THEN PRINT 1 ELSE PRINT 2`, the ELSE belongs to the second IF, so nothing happens if A is false) |
| FOR / NEXT | `FOR I=1 TO 10 STEP 2` … `NEXT I` | Loop. The variable after NEXT can be omitted. `NEXT J,I` also works |

### Data

| Command | Examples | Description |
| --- | --- | --- |
| LET | `LET A=1`, `A=1` | Assignment (LET can be omitted) |
| DIM | `DIM A(10),B$(3,4)` | Arrays |
| DATA / READ / RESTORE | `DATA 1,2,"A"`, `DATA &HA2,&H41`, `READ A,B,C$`, `RESTORE`, `RESTORE 100` | Data. Numbers can also be written in hexadecimal (`&H`) |
| POKE / CALL | `POKE &H600,169`, `CALL &H600` | Write to memory, call machine code (return with RTS) |

### Input and output

| Command | Examples | Description |
| --- | --- | --- |
| PRINT / `?` | `PRINT A;B$,C`, `PRINT TAB(5);"X";SPC(2);"Y"` | Output. `;` continues on the same line, `,` moves to the next 8-column zone. A trailing `;` or `,` suppresses the newline |
| INPUT | `INPUT A`, `INPUT "NAME";N$`, `INPUT A,B` | Reads from the keyboard (shows `? ` and waits). Typing something that is not a number where a number is expected gives `?REDO` and asks again. If you type too few values, it asks for the rest with `?? `. An error in direct mode |
| CLS | `CLS` | Clears the screen |
| LOCATE | `LOCATE 0,3` | Sets the text position (column 0 to 15, line 0 to 3) |
| WAIT | `WAIT 64` | Waits (in 1/64 seconds; BREAK stops it) |
| BEEP | `BEEP`, `BEEP 440`, `BEEP 880,50` | Sound. Frequency (Hz), length (1/100 seconds, fractions allowed). Defaults to 1000Hz for 0.1 seconds. The frequency with its fraction dropped must be 20–20000. The length must be 0 or more, and frequency × length ÷ 50 (the number of half cycles of the sound) with its fraction dropped must be 65535 or less. Otherwise you get `?FC ERROR`. So the longest length depends on the frequency (at 1000Hz, up to 3276 as a whole number, about 33 seconds). Calculations with fractions are rounded, so avoid lengths right at the limit |
| DEG / RAD | | Angle unit for trigonometric functions (degrees / radians). Lights DEG / RAD on the LCD. RAD at startup |
| RANDOMIZE | `RANDOMIZE` | Sets the random seed from the timer (does not change the last value that `RND(0)` returns) |

How INPUT reads the answer:

- Items are separated by `,`. Extra items are ignored. Pressing RET without typing anything asks again with `?? ` (a line of only spaces is read as an empty answer: 0 for a numeric variable, an empty string for a string variable)
- Numbers are read skipping spaces at the start and inside (`1 2` is 12). Hex `&H` numbers work too. Anything other than `,` or the end of the line after a number gives `?REDO`
- A string in `"..."` can contain `,` and `:` (anything other than `,` or the end of the line after the closing quote gives `?REDO`). Without quotes, the string starts after the leading spaces and goes up to just before `,` or `:` (trailing spaces are kept)
- A `:` outside quotes is treated as the end of the line. Nothing after the `:` is read; if variables are left, `?? ` asks for the rest

### Graphics

The screen is 96×32 dots. The top-left is (0,0) and the bottom-right is (95,31). Coordinates have their fraction dropped and can be from -1024 to 1023 (beyond that you get `?FC ERROR`). Points in that range but outside the screen are not drawn (it's fine for part of a line or circle to go off the screen). Text and graphics share the same screen.

| Command | Examples | Description |
| --- | --- | --- |
| PSET / PRESET | `PSET 10,5`, `PSET 10,5,2`, `PRESET 10,5` | Draws / erases a dot. The third argument is 1 to draw, 0 to erase, 2 to invert |
| LINE | `LINE 0,0,95,31`, `LINE 0,0,95,31,0` | Line (the last argument is the same as for PSET) |
| CIRCLE | `CIRCLE 48,16,10`, `CIRCLE 48,16,10,2` | Circle (center, radius; the last argument is the same as for PSET) |

### Tape

| Command | Examples | Description |
| --- | --- | --- |
| SAVE | `SAVE "GAME"` | Saves the program at the end of the tape. The name can be up to 8 characters (if omitted, the name is blank) |
| LOAD | `LOAD "GAME"`, `LOAD` | Loads the program with that name (the last one if there are several). Without a name, loads the first program. Clears variables |
| FILES | `FILES` | Lists what is on the tape (`B` is a program, `M` is memory saved with the monitor's W; then the name and the length) |

```
>FILES
B GAME     312
M SPRITE   256
```

- Saving always adds to the end of the tape. To empty the tape, eject it with the emulator's **Eject tape** and start a new one (if no tape is inserted, saving creates a new tape)
- If you save under the same name more than once, all of them stay on the tape (`FILES` lists them all), and `LOAD "NAME"` reads the one furthest along the tape, that is, the one saved last
- A tape holds up to 65,536 bytes in total. If a program doesn't fit, you get `?TF ERROR` and the tape is left as it was before saving
- The emulator's **Save tape** saves the tape as a file, and **Insert tape** puts it back

## Functions

| Function | Description |
| --- | --- |
| `ABS(x)` `SGN(x)` `INT(x)` | Absolute value, sign (-1, 0, 1), largest integer not greater than x (`INT(-3.7)` is -4) |
| `SQR(x)` | Square root |
| `SIN(x)` `COS(x)` `TAN(x)` `ATN(x)` | Trigonometric functions (angles follow DEG / RAD) |
| `EXP(x)` `LN(x)` `LOG(x)` | e^x, natural logarithm, common logarithm (base 10) |
| `PI` | Pi (3.14159265) |
| `RND(x)` | Random number from 0 up to (but not including) 1. x>0 gives the next value, x<0 reseeds from x and gives the first value, x=0 repeats the last value made. RANDOMIZE, RUN, CLEAR and reset keep the last value. If none has been made since starting with cleared RAM, it is 0 |
| `PEEK(a)` `FRE(0)` | Value in memory, free bytes |
| `POINT(x,y)` | 1 if the dot is on, 0 if off (0 outside the screen; `?FC ERROR` if a coordinate is beyond -1024 to 1023) |
| `LEN(s$)` `ASC(s$)` `VAL(s$)` | Length, code of the first character, conversion to a number (0 if it's not a number) |
| `CHR$(n)` `STR$(x)` `HEX$(n)` | Character, number as a string (a space in front of positive numbers), hexadecimal string |
| `LEFT$(s$,n)` `RIGHT$(s$,n)` `MID$(s$,p[,n])` | Substrings (positions start at 1) |
| `INSTR([p,]s$,t$)` | Position of t$ in s$ (0 if not found), searching from p |
| `INKEY$` | The key pressed (an empty string if none). Doesn't wait. ← and → give `CHR$(17)` and `CHR$(18)` |
| `TAB(n)` `SPC(n)` | Only inside PRINT. Move to column n / n spaces |

`LOG` is the common logarithm (Microsoft BASIC's `LOG` is the natural logarithm, so change it to `LN` when porting programs).

## Errors

Errors are shown as `?SN ERROR IN 120` (without the `IN` part in direct mode).

| Code | Meaning |
| --- | --- |
| SN | Syntax error |
| OV | Number too large |
| /0 | Division by zero |
| FC | Invalid value given to a function or command (`SQR(-1)`, `CHR$(300)`, `SIN(1E10)`, etc.) |
| UL | No such line number |
| OM | Out of memory, or expressions or FOR / GOSUB nested too deeply |
| TM | Type mismatch (number vs. string) |
| BS | Array subscript out of range |
| DD | The same array was DIMmed twice |
| LS | String longer than 255 characters |
| NF | NEXT without FOR |
| RG | RETURN without GOSUB |
| OD | Out of DATA for READ |
| CN | Can't CONT |
| ID | Not allowed in direct mode (INPUT, etc.) |
| NT | No tape, or not found on the tape |
| TP | The data on the tape is damaged |
| TF | The tape is full (the tape is left as it was before saving; switch to a new tape) |

## Example programs

```
10 REM SINE CURVE
20 CLS
30 FOR X=0 TO 95
40 PSET X,16-14*SIN(X*PI/48)
50 NEXT
60 LINE 0,16,95,16
```

```
10 REM GUESS THE NUMBER
20 RANDOMIZE:N=INT(RND(1)*100)+1
30 INPUT "1-100";G
40 IF G=N THEN PRINT "OK!":BEEP 880,30:END
50 IF G<N THEN PRINT "UP" ELSE PRINT "DOWN"
60 GOTO 30
```

More programs are in `samples/` (see `docs/guide.en.md`).

## Speed and limits

- Speed (at 1MHz): an empty `FOR` loop runs 700 to 1000 times per second. `A=A+I*2` takes about 6 milliseconds. Functions such as `SQR`, `SIN` and `EXP` take 30 to 50 milliseconds each
- Accuracy as a guide. The error is how far the answer is off for the argument as it is held as a number, in ulp (the size of the lowest bit of the mantissa, about 2.3E-10 to 4.7E-10 times the answer). These figures come from testing many cases and are not a guarantee for every input. Answers too small to be held (which become 0) and errors are not included: `SQR` always gives the nearest value. `EXP` and `ATN` are within 2 ulp (6 ulp for `ATN` in degrees), `LN`, `SIN` and `COS` within 4 ulp, `LOG` and `TAN` within 5 ulp (`SIN`, `COS` and `TAN` in radians also have the error described in the next item). In the 9-digit display, the last digit may be off by one. When `^` is computed by repeated multiplication, the error builds up with the number of multiplications (within about 2 + 2 × `ABS(n)` ulp for an exponent n; exact if the answer can be represented exactly). When it is computed as `EXP(y*LN(x))`, the error grows as the answer gets larger (or smaller): within about 4 + 5 × `ABS(LN(ABS(answer)))` ulp, so for an answer around 1E30 about the last two digits may be off. Reading a number you type, or `VAL`, is within 1 ulp for up to 9 digits (1.5 ulp for 10 digits). The display of `PRINT` and `STR$` may be off by one in the last digit (integers up to 9 digits are exact both when read and when displayed)
- Arguments to `SIN`, `COS` and `TAN` can be up to about 6.7E9 in radians, or about 2.4E10 in degrees. Beyond that you get `?FC ERROR` (the answer can't be computed accurately). In radians, the nearest multiple of π/2 is subtracted before the calculation, so digits usually aren't lost even when the answer is close to 0 (`SIN(3.14138865)` gives ` 2.04003536E-04`, correct in all 9 digits). But π/2 is also held with a limited number of digits (about 64 bits), so an absolute error of about 2E-22 times the argument remains. When the answer is smaller than about 1E-12 times the argument (the argument is very close to an angle where the answer is 0: a multiple of π for `SIN` and `TAN`, π/2 plus a multiple of π for `COS`), this error makes the lower digits wrong (`SIN(680232721/2048)` gives `-3.59863607E-10`; the correct value is `-3.59863537E-10`. `TAN(680232721/2048)` likewise gives ` 3.59863607E-10`). Above about 17 million (2^24), subtracting the multiple of π/2 also adds some error, and the absolute error is about 1E-9 or less. π can't be represented exactly, so `SIN(PI)` gives the correct value for the rounded π, ` 1.2154201E-10`, rather than 0 (`SIN(3*PI)` gives `-1.49801912E-09`). `TAN` also loses accuracy when the answer is very large (angles where COS is close to 0)
- In degrees, the angle is split exactly into multiples of 90 degrees before the calculation, so multiples of 90 give exact values (`COS(90)` and `SIN(180)` are 0, `SIN(90)` is 1). Undefined angles such as `TAN(90)` and `TAN(-90)` give `?/0 ERROR`
- These errors and exact values are for the argument as it is held as a number. If the number you type can't be represented exactly (integers above about 4.3 billion = 2^32, or fractions that don't divide evenly in binary), the answer is off by the rounding of the input. For example, in degrees `SIN(18000000090)` gives `.999390827` rather than 1, because the argument is rounded to 18000000088. Near 90 degrees, `COS(89.9999)` has a relative error of about 1E-4 because 89.9999 is rounded
- How deeply `FOR` and `GOSUB` can nest depends on the CPU stack (256 bytes). Each `FOR` uses 17 bytes, each `GOSUB` 5 bytes
- When string space fills up, it is tidied up automatically (with a short pause)
- Line numbers range from 0 to 63999

## Memory map

| Range | Use |
| --- | --- |
| `$00-$7F` | Free (for machine code) |
| `$80-$DF` | BASIC |
| `$E0-$FF` | Monitor, BIOS |
| `$0100-$01FF` | CPU stack (also used for FOR, GOSUB and expression evaluation) |
| `$0200-$02C5` | Monitor work area |
| `$02C6-$02FF` | BASIC work area (math functions, graphics, BEEP, tape) |
| `$0300-$037F` | Input line (`$0300`, 64 bytes) and previous line (`$0340`) |
| `$0380-$03FF` | BASIC work area |
| `$0400-$057F` | VRAM |
| `$0580-$07FE` | Free (for machine code; callable with `CALL`) |
| `$07FF` | Used by BASIC (always 0; marks the start of the program) |
| `$0800-$7FFE` | Program, variables, arrays, strings (program, variables and arrays from the bottom up; strings from the top down) |
| `$7FFF` | Used by BASIC (`VAL` temporarily puts a 0 just after a string; no string is placed here) |

Program lines are stored from `$0800` as `[address of next line (2)][line number (2)][contents (keywords as 1-byte tokens)][0]`. The end is marked by a next-line address of 0. The byte just before them, `$07FF`, holds 0 (`RUN` and `RESTORE` start reading there, treating it as the end of a previous line). If `POKE` or the like makes `$07FF` nonzero, `RUN` gives `?SN ERROR`. `NEW` and `LOAD` set it back to 0.

## Tape format

Shared with the monitor. A tape can hold several blocks one after another.

| Bytes | Contents |
| --- | --- |
| 0-1 | `"PX"` |
| 2 | Type: `$01` memory (monitor's W), `$02` BASIC program |
| 3-10 | Name (8 characters, padded with spaces) |
| 11-12 | Start address (low, high) |
| 13-14 | Length (low, high) |
| 15- | Data |
| Last | Checksum (low 8 bits of the sum of all earlier bytes of this block) |

BASIC programs are saved from `$0800` and loaded back to `$0800`.
