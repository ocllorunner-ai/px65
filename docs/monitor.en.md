# PX-65 Monitor

[日本語](monitor.md) | English

This is the manual for the monitor built into the PX-65 ROM. With it you can view and change memory, assemble, run programs, step through them one instruction at a time, and save to tape.

The source is `rom/monitor.s` (shared definitions are in `rom/px65.inc`). It occupies the 8KB at `$E000-$FFFF` of the 24KB ROM (about 6.7KB used). The 16KB at `$A000-$DFFF` holds BASIC (`docs/basic.en.md`).

![The startup screen](monitor.png)

## Starting

The built-in ROM contains BASIC, so BASIC starts when you turn the power on. Type `MON` in BASIC to enter the monitor; its prompt is `*`. Type `Q` in the monitor to go back to BASIC. The program and variables are kept, the screen is left as it is, and BASIC's `>` prompt appears (if memory changed in the monitor has damaged BASIC's record of how memory is used, only the variables are cleared). Reset clears the variables.

With a ROM that has no `BASIC` mark at `$A006` (a monitor-only ROM), turning the power on shows `PX-65 MONITOR` `V0.11` followed by the `*` prompt.

- **Cold start** (power on): initializes the work area, registers and breakpoints
- **Warm start** (reset, or power on with RAM kept): RAM and breakpoints are kept. If you reset while a program is running, BRK instructions written for breakpoints are restored to the original bytes

## Typing commands

- A command is one letter followed by its arguments. Examples: `D 600`, `E 600 A9 01`
- All numbers are hexadecimal, written without `$`. `0600` and `600` are the same
- Separate arguments with spaces or commas. Letters can be upper or lower case
- A line can be up to 58 characters. It wraps to the next line at the right edge of the screen
- **←** **→** move the cursor, and what you type goes in at the cursor. **DEL** deletes the character before the cursor. **↑** brings back the previous line. **RET** enters the whole line wherever the cursor is
- **BREAK** cancels the line being typed or the running command and returns to the prompt
- Invalid input shows `?` and beeps

With SHIFT, keys give these characters:

| Key | A–Z | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0 | , | . | ÷ | - | × | + | = |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHIFT+ | a–z | ! | " | # | $ | % | & | ' | ( | ) | @ | < | > | ? | _ | : | ; | ^ |

The arrows, SPACE, RET and DEL are the same with or without SHIFT. The emulator's on-screen keys show the SHIFT character small in their top-right corner. Holding a key down for 0.5 seconds repeats it.

On a computer keyboard, just type the symbol (you get the symbol you typed, whatever your keyboard layout).

## Commands

| Command | Syntax | Description |
| --- | --- | --- |
| D | `D [address]` | Memory dump |
| E | `E address [value ...]` | Write to memory |
| F | `F start end value [value ...]` | Fill a range with values |
| M | `M start end destination` | Move (copy) memory |
| S | `S start end value [value ...]` | Search for bytes |
| C | `C start end other` | Compare two ranges |
| H | `H value1 value2` | Sum and difference |
| U | `U [address]` | Disassemble |
| A | `A [address]` | Assemble (one line at a time) |
| R | `R [register value]` | Show and change registers |
| G | `G [address]` | Run |
| T | `T [count]` | Trace (run one instruction at a time) |
| P | `P [count]` | Trace, running JSR calls in one go |
| B | `B` / `B address` / `B - [address]` | Breakpoints |
| W | `W start end ["name"]` | Save to tape |
| L | `L ["name"] [address]` | Load from tape |
| Q | `Q` | Back to BASIC (the program and variables are kept) |

The end address is included in the range. A list of values can contain `"strings"` as well as hex numbers. Example: `E 700 "Hello" 0`

### D: Memory dump

```
*D 600
0600 A9 42 A2 07
0604 60 00 00 00
0608 00 00 00 00
060C 00 00 00 00
```

Shows 16 bytes (a full screen) and waits for a key.

| Key | Action |
| --- | --- |
| ↓ / ↑ | Forward / back 4 bytes |
| RET / SPACE | Forward 16 bytes |
| Any other key | Stops. A letter key becomes the first letter of the next command |

Without an address, it continues from where the last dump ended.

### E: Write to memory

With values, as in `E 600 A9 42 A2 07 60`, it writes them in order from that address (up to 16 bytes).

Without values, `E 600` edits one byte at a time. It shows the address and the current value, like `0600 A9-`; type the new value.

| Key | Action |
| --- | --- |
| 0–9, A–F | Enter the value (up to 2 digits) |
| DEL / ← | Delete a digit |
| SPACE / ↓ | Write and go to the next address |
| ↑ | Write and go to the previous address |
| RET | Write and finish |

Moving on without typing anything leaves that address unchanged.

### F, M, S, C

- `F 600 6FF 0` fills `$0600-$06FF` with 0. With several values, as in `F 600 6FF 1 2 3`, the sequence repeats
- `M 600 6FF 1000` copies `$0600-$06FF` to `$1000` onward. Overlapping ranges are copied correctly
- `S 600 7FFF A9 00` shows the addresses where `A9 00` is found, three per line
- `C 700 7FF 1000` shows each differing byte on its own line, like `0705 12 1005 34`

### H: Sum and difference

```
*H 1234 100
1334 1134
```

### U: Disassemble

```
*U 600
0600 LDA #42
0602 LDX #07
0604 RTS
0605 BRK
```

Shows four lines and waits for a key. **↓** moves one line, **RET** or **SPACE** four lines. Any other key stops (as with D). Without an address, it continues from where it left off.

Numbers are shown without `$`. `#42` is immediate, `0400` is absolute, `(02),Y` is indirect. Branches show the destination address. Only `BBR`/`BBS` lines are longer than 16 characters, so they wrap to the next line.

### R: Registers

```
*R
A=42 X=07 Y=00
S=FF P=..-B....
0600 LDA #42
```

The first line shows A, X and Y; the second, the stack pointer and the flags; the third, the PC address and the instruction there. The flags are shown in the order `NV-BDIZC`: the letter if set, `.` if clear.

`R A 12`, `R X 0`, `R Y FF`, `R S FF`, `R P 0` and `R PC 600` change that register.

### G: Run

- `G 600` starts running from `$0600`. The stack pointer starts at `$FF`. When the program finally does **RTS**, it returns to the monitor and shows the registers
- `G` continues from where it stopped (the PC address). After returning to the monitor with RTS, `G` also runs from the PC address (where it last stopped) and pushes a new return address to the monitor. To run the program again from the start, give the address, as in `G 600`
- In both cases, if there is a breakpoint at the PC address, that one instruction runs first, then the breakpoints are written and it continues

BUSY lights on the LCD while running. It returns to the monitor and shows the registers when one of these happens:

| Reason for stopping | PC shown |
| --- | --- |
| A program started with G did RTS | (not shown) |
| It reached a breakpoint | The breakpoint address (that instruction has not run yet) |
| The program executed a BRK instruction | 2 bytes after the BRK |
| The BREAK key was pressed | The next instruction to run |

### T, P: Trace

`T` runs one instruction and shows the registers. With a count, as in `T 10`, it runs that many instructions before showing them (up to `FF`).

`P` is the same as `T`, but runs a JSR until the subroutine returns.

Set the PC first, for example with `R PC 600`.

If the next instruction can go to `$00E0-$057F` (the monitor and BIOS zero page, the stack, the work area, the input lines and VRAM; for a branch, either way it may go), it does not run that instruction: it shows the registers and then `?`. In the middle of a count such as `T 10`, it stops where it has got to. A JSR with P still works, because P writes no BRK inside the subroutine. The BRK used for stepping can't be written to these addresses (the monitor is using them at that moment, so writing there would break the monitor).

### B: Breakpoints

| Syntax | Action |
| --- | --- |
| `B` | List them (`-` if none) |
| `B 620` | Set a breakpoint at `$0620` (up to 4) |
| `B - 620` | Remove the breakpoint at `$0620` |
| `B -` | Remove all |

Breakpoints can only be set at `$0000-$00DF` and `$0580-$7FFF`. Any other address (`$00E0-$057F` and the ROM) gives `?`. The monitor uses `$00E0-$057F` while it is getting ready to run, so a BRK written there would break the monitor.

A BRK instruction is written at the address only while running with `G`, and the original byte is restored when it stops. So you never see the BRK when viewing memory in the monitor. Put breakpoints on the first byte of an instruction. If you put one in the middle of an instruction or on data, that byte becomes BRK (`$00`) while running, and the program does not work correctly.

Running `G` when stopped at a breakpoint executes that one instruction first, then writes the breakpoints and continues.

If a breakpoint at an address that is no longer allowed is still set (for example, after loading a state saved with an earlier version), `G` runs nothing and shows `?`. Remove it with `B - address`.

### A: Assemble

`A 600` shows the address `0600 `; type one instruction and press RET. It writes the instruction and shows the next address. Press RET on an empty line to finish.

```
*A 600
0600 LDA #41
0602 JSR FF00
0605 RTS
0606
*
```

- The syntax is the same as `U` shows. Numbers are hexadecimal, with or without `$`. Letters can be lower case
- Operands: `#41` (immediate), `12` (zero page), `0400` (absolute), `12,X`, `0400,Y`, `(12,X)`, `(12),Y`, `(12)`, `(1234)`, `(1234,X)`, `A` (accumulator; plain `ASL` also works. For an instruction with no accumulator form, `A` is read as the address `0A`: `LDA A` is `LDA 0A`, `JMP A` is `JMP 000A`)
- An operand written with **2 digits or fewer is zero page; 3 digits or more is absolute**. `LDA 0012` gives the absolute form even for a small value. If the instruction lacks one form, the other is used instead (`JMP 12` is `JMP 0012`)
- For branches, write the destination address (`BNE 0600`). It's an error if out of reach
- Write `RMB`, `SMB`, `BBR` and `BBS` with the bit number (`RMB3 12`, `BBS7 12,0620`)
- A mistake shows `?` and beeps, and you can type the line again at the same address. **↑** brings back the line you just typed, so fix it and press RET
- Without an address, it continues from where the last `A` ended. After `A`, `U` starts from the address where `A` started
- There are no labels or directives like `.byte`. Write data with `E`

### W, L: Tape

A tape can hold several blocks one after another. Saving always adds to the end of the tape (the earlier contents are kept). To empty the tape, eject it with the emulator's **Eject tape**.

- `W 600 6FF "SPRITE"` saves `$0600-$06FF` on the tape under the name `SPRITE` and shows `SAVE 0600-06FF`. Names can be up to 8 characters (longer names are cut) and are case-sensitive. Without a name, the name is blank
- `L "SPRITE"` finds the block with that name, writes it back to the address it was saved from, and shows `LOAD 0600-06FF`. If several blocks have that name, it reads the one furthest along the tape (the one saved last)
- `L` loads the first memory block (BASIC program blocks are skipped)
- `L 1000`, `L "SPRITE" 1000`: with an address, it loads there instead

After loading, the PC is set to the loaded address and the next `G` starts a new run, so just `G` runs what you loaded. `D` and `U` also continue from the loaded address.

| Message | Meaning |
| --- | --- |
| `NO TAPE` | Nothing is on the tape |
| `NOT FOUND` | No block with that name (or no memory block) |
| `TAPE ERROR` | Not in PX-65 format, cut short, or the checksum doesn't match |
| `TAPE FULL` | The tape is full and the block can't be saved (W; the tape is left as it was before saving) |

To save the tape as a file, press the emulator's **Save tape**. To load from a file, choose it with **Insert tape**, then type `L`. The browser remembers the tape, so it is still there when you reopen the page.

BASIC's `FILES` lists what is on the tape.

Tape format (blocks one after another; shared with BASIC):

| Bytes | Contents |
| --- | --- |
| 0-1 | `"PX"` (`$50 $58`) |
| 2 | Type: `$01` = memory (W), `$02` = BASIC program |
| 3-10 | Name (8 characters, padded with spaces) |
| 11-12 | Start address (low, high) |
| 13-14 | Length (low, high) |
| 15- | Data |
| Last | Checksum (low 8 bits of the sum of all earlier bytes of this block) |

## Trying it out

This program prints "A" with the BIOS routine CHROUT and returns. Type it in with `A`.

```
*A 600
0600 LDA #41
0602 JSR FF00
0605 RTS
0606
*
```

Writing the bytes with `E 600 A9 41 20 00 FF 60` does the same. Check it with `U 600`.

Run it with `G 600`.

```
*G 600
A
A=41 X=00 Y=00
S=FF P=..-B...C
```

"A" is printed, RTS returns to the monitor, and the registers are shown.

To follow it one instruction at a time:

```
*R PC 600
*T
*T
```

## Routines for programs (BIOS)

Call the jump table at `$FF00` with JSR. These addresses will not change.

| Address | Name | Input | Output | Registers changed |
| --- | --- | --- | --- | --- |
| `$FF00` | CHROUT | A = character | | none |
| `$FF03` | GETKEY | | A = key (waits until one is pressed) | none |
| `$FF06` | KEYCHK | | C=1 and A = key if there is one; otherwise C=0 | none |
| `$FF09` | GETLINE | | One line in `LINEBUF` (`$0300`, up to 58 characters), its length in `LINELEN` (`$0250`). The keys work as in "Typing commands" (← → move, insert, DEL, ↑) | A, X |
| `$FF0C` | PRHEX | A = value | Prints 2 hex digits | none |
| `$FF0F` | PRINT | A zero-terminated string right after the JSR | Prints the string and returns after it | A |
| `$FF12` | BEEP | A = pitch, X = length | | A, X, Y |
| `$FF15` | CLS | | Clears the screen and moves the cursor to the top left | A, X |
| `$FF18` | LOCATE | X = column (0 to 15), Y = line (0 to 3) | | none |
| `$FF1B` | MONITOR | | Returns to the monitor and shows the registers | |
| `$FF1E` | GETLINE_ED | Characters in `LINEBUF`, length in `LINELEN` | Shows them, then lets the user continue typing (output as for GETLINE) | A, X |
| `$FF21` | MONENTER | | Enters the monitor prompt (BASIC's `MON`) | |
| `$FF24` | TSAVE | `T_TYPE` `T_NAME` `T_START` `T_LEN` | Adds that block to the end of the tape. C=0 if saved. C=1 if the tape is full, with A = 4 (the tape is left as it was) | A, X, Y |
| `$FF27` | TFIND | A = 0 from the start, 1 continue | Reads the next block's header into `T_TYPE` etc. C=0 if found. C=1 with A = 1 no tape, 2 no more blocks, 3 damaged | A, X, Y |
| `$FF2A` | TLOAD | `T_START` | Writes the data of the block found by TFIND from `T_START`. C=1 if damaged (A = 3) | A, X, Y |
| `$FF2D` | CUROFF | | Hides the blinking cursor | A |

- CHROUT control characters: `$0D` newline, `$08` back up one character and erase it, `$0C` clear the screen. `$20-$7E` are characters. Everything else is ignored. A newline on the fourth line scrolls the screen up one line
- GETKEY key codes: a character key gives its character; RET `$0D`, DEL `$08`, ← `$11`, → `$12`, ↑ `$13`, ↓ `$14`. Keys are read by the timer interrupt, so use GETKEY, KEYCHK and GETLINE with interrupts enabled (I=0)
- BEEP pitch: the half period is about 5×A+12 cycles, so A=100 gives about 1kHz. X is the number of periods (1 to 255; 0 means 256)
- Tape header addresses: `T_TYPE` `$02A0`, `T_NAME` `$02A1` (8 bytes), `T_START` `$02A9`, `T_LEN` `$02AB`. They are defined in `rom/px65.inc`
- PRINT example:

```
        jsr $FF0F
        .byte "HELLO", 0
        rts
```

## Memory map

| Range | Use |
| --- | --- |
| `$00-$7F` | For user programs |
| `$80-$DF` | For BASIC (for user programs if BASIC isn't used) |
| `$E0-$FF` | For the monitor and BIOS (`$F2-$F3` counts timer interrupts, increasing at 64Hz) |
| `$0100-$01FF` | Stack |
| `$0200-$02C5` | Monitor work area (key buffer, registers, breakpoints, tape, etc.) |
| `$02C6-$02FF` | BASIC work area |
| `$0300-$037F` | Input line (`$0300`) and previous line (`$0340`) |
| `$0380-$03FF` | BASIC work area |
| `$0400-$057F` | VRAM |
| `$0580-$07FE` | For user programs. `R`'s initial PC is `$0600` |
| `$07FF` | Used by BASIC (always 0; for user programs if BASIC isn't used) |
| `$0800-$7FFF` | BASIC program and variables (`$7FFF` is used by BASIC for `VAL`; for user programs if BASIC isn't used) |
| `$8000-$80FF` | I/O |

### Interrupts

Interrupts are handled through vectors in RAM. To replace an interrupt handler, change these.

| Address | Contents | Default handler |
| --- | --- | --- |
| `$02C0` | IRQ vector | Timer interrupt (reads the keyboard) |
| `$02C2` | BRK vector | Returns to the monitor |
| `$02C4` | NMI vector | The BREAK key |

Each vector is called with the registers and stack exactly as they were when the interrupt happened (so you can return with RTI). When replacing the IRQ handler, JMP on to the original handler so the keyboard keeps working. Reset restores the default vectors.

## Limitations and notes

- You can't trace inside the ROM (BRK can't be written there). When T reaches a JSR to a ROM subroutine, it runs it in one go, like P. After a JMP into the ROM, execution simply continues
- An instruction that branches to itself (such as `BNE *`) can't be stepped with T
- An instruction that goes to `$00E0-$057F` can't be stepped with T or P (it gives `?`; a JSR with P is fine). It does run with G
- If the start of the input line has scrolled off the top of the screen (this only happens after a long BASIC `INPUT` prompt followed by nearly 58 characters), ← can't move back past what is visible
- Don't load into the monitor's work area (`$0200-$037F`) or zero page `$E0-$FF`. Doing so breaks the monitor

## Rebuilding the ROM

```sh
npm run rom         # assemble BASIC and the monitor into rom/px65.bin (the built-in ROM)
npm run monitor     # build the monitor-only ROM (rom/monitor.bin)
npm run samples     # rebuild the sample tape (samples/samples.tap) with the new ROM
npm run build       # build dist/ with rom/px65.bin as the built-in ROM
npm test            # all tests, including the monitor's (also checks that the ROMs, the tape and dist/ match the sources)
```

- `rom/font.s` is generated by `tools/mkfont.js`. To change the character shapes, edit `GLYPHS` in `tools/mkfont.js`
- `rom/optable.s` is generated by `tools/mkoptable.js` from the CPU core's opcode table (`src/cpu65c02.js`)
