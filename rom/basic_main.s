; PX-65 BASIC: 起動、入力、トークン化、プログラムの保存、実行の中心、エラー

; ===================================================================
; トークン(kwtab の順。$80 から)
; ===================================================================
TK_END     = $80
TK_FOR     = $81
TK_NEXT    = $82
TK_DATA    = $83
TK_INPUT   = $84
TK_DIM     = $85
TK_READ    = $86
TK_LET     = $87
TK_GOTO    = $88
TK_RUN     = $89
TK_IF      = $8A
TK_RESTORE = $8B
TK_GOSUB   = $8C
TK_RETURN  = $8D
TK_REM     = $8E
TK_STOP    = $8F
TK_ON      = $90
TK_WAIT    = $91
TK_LOAD    = $92
TK_SAVE    = $93
TK_POKE    = $94
TK_PRINT   = $95
TK_CONT    = $96
TK_LIST    = $97
TK_CLEAR   = $98
TK_NEW     = $99
TK_CLS     = $9A
TK_LOCATE  = $9B
TK_PSET    = $9C
TK_PRESET  = $9D
TK_LINE    = $9E
TK_CIRCLE  = $9F
TK_BEEP    = $A0
TK_DEG     = $A1
TK_RAD     = $A2
TK_RANDOM  = $A3
TK_CALL    = $A4
TK_FILES   = $A5
TK_MON     = $A6
TK_EDIT    = $A7
TK_DELETE  = $A8
TK_ELSE    = $A9            ; 命令として扱う最後のトークン
TK_TO      = $AA
TK_STEP    = $AB
TK_THEN    = $AC
TK_TAB     = $AD
TK_SPC     = $AE
TK_AND     = $AF
TK_OR      = $B0
TK_NOT     = $B1
TK_SGN     = $B2            ; ここから関数
TK_INT     = $B3
TK_ABS     = $B4
TK_FRE     = $B5
TK_SQR     = $B6
TK_RND     = $B7
TK_LN      = $B8
TK_LOG     = $B9
TK_EXP     = $BA
TK_COS     = $BB
TK_SIN     = $BC
TK_TAN     = $BD
TK_ATN     = $BE
TK_PEEK    = $BF
TK_LEN     = $C0
TK_STRS    = $C1
TK_VAL     = $C2
TK_ASC     = $C3
TK_CHRS    = $C4
TK_HEXS    = $C5
TK_POINT   = $C6
TK_PI      = $C7
TK_INKEYS  = $C8
TK_LEFTS   = $C9
TK_RIGHTS  = $CA
TK_MIDS    = $CB
TK_INSTR   = $CC            ; 最後の関数
TK_RENUM   = $CD            ; 後から足した命令(保存したプログラムのトークンが変わらないように最後に置く)
TK_CALC    = $CE            ; 後から足した命令

; キーワード(最後の文字は bit7 を立てる)。この順がトークンの番号
kwtab:
        .byte "EN", 'D'+$80
        .byte "FO", 'R'+$80
        .byte "NEX", 'T'+$80
        .byte "DAT", 'A'+$80
        .byte "INPU", 'T'+$80
        .byte "DI", 'M'+$80
        .byte "REA", 'D'+$80
        .byte "LE", 'T'+$80
        .byte "GOT", 'O'+$80
        .byte "RU", 'N'+$80
        .byte "I", 'F'+$80
        .byte "RESTOR", 'E'+$80
        .byte "GOSU", 'B'+$80
        .byte "RETUR", 'N'+$80
        .byte "RE", 'M'+$80
        .byte "STO", 'P'+$80
        .byte "O", 'N'+$80
        .byte "WAI", 'T'+$80
        .byte "LOA", 'D'+$80
        .byte "SAV", 'E'+$80
        .byte "POK", 'E'+$80
        .byte "PRIN", 'T'+$80
        .byte "CON", 'T'+$80
        .byte "LIS", 'T'+$80
        .byte "CLEA", 'R'+$80
        .byte "NE", 'W'+$80
        .byte "CL", 'S'+$80
        .byte "LOCAT", 'E'+$80
        .byte "PSE", 'T'+$80
        .byte "PRESE", 'T'+$80
        .byte "LIN", 'E'+$80
        .byte "CIRCL", 'E'+$80
        .byte "BEE", 'P'+$80
        .byte "DE", 'G'+$80
        .byte "RA", 'D'+$80
        .byte "RANDOMIZ", 'E'+$80
        .byte "CAL", 'L'+$80
        .byte "FILE", 'S'+$80
        .byte "MO", 'N'+$80
        .byte "EDI", 'T'+$80
        .byte "DELET", 'E'+$80
        .byte "ELS", 'E'+$80
        .byte "T", 'O'+$80
        .byte "STE", 'P'+$80
        .byte "THE", 'N'+$80
        .byte "TAB", '('+$80
        .byte "SPC", '('+$80
        .byte "AN", 'D'+$80
        .byte "O", 'R'+$80
        .byte "NO", 'T'+$80
        .byte "SG", 'N'+$80
        .byte "IN", 'T'+$80
        .byte "AB", 'S'+$80
        .byte "FR", 'E'+$80
        .byte "SQ", 'R'+$80
        .byte "RN", 'D'+$80
        .byte "L", 'N'+$80
        .byte "LO", 'G'+$80
        .byte "EX", 'P'+$80
        .byte "CO", 'S'+$80
        .byte "SI", 'N'+$80
        .byte "TA", 'N'+$80
        .byte "AT", 'N'+$80
        .byte "PEE", 'K'+$80
        .byte "LE", 'N'+$80
        .byte "STR", '$'+$80
        .byte "VA", 'L'+$80
        .byte "AS", 'C'+$80
        .byte "CHR", '$'+$80
        .byte "HEX", '$'+$80
        .byte "POIN", 'T'+$80
        .byte "P", 'I'+$80
        .byte "INKEY", '$'+$80
        .byte "LEFT", '$'+$80
        .byte "RIGHT", '$'+$80
        .byte "MID", '$'+$80
        .byte "INST", 'R'+$80
        .byte "RENU", 'M'+$80
        .byte "CAL", 'C'+$80
        .byte 0

; ===================================================================
; 起動
; ===================================================================

; コールドスタート: プログラムを消して起動する
b_cold:
        jsr b_sys
        stz val_ptr+1           ; RAM の中身は意味がないので、VAL の戻しはしない
        jsr b_new_mem
        stz angmode
        lda #$A5                ; 乱数の種(0 以外)
        sta rndseed
        sta rndseed+1
        sta rndseed+2
        sta rndseed+3
        lda #BMAGIC1
        sta bmagic
        lda #BMAGIC2
        sta bmagic+1
        jsr b_banner
        jsr fre_bytes           ; "30719 BYTES FREE"
        jsr fac_u16
        jsr fout
        jsr out_fbuf_nosign
        jsr strout_inline
        .byte " BYTES FREE", 0
        jmp ready

; ウォームスタート: プログラムを残して起動する(リセット、モニターの Q)
; ウォームスタート。C=0 ならリセットから(変数を消し、画面を消して名前を出す)。
; C=1 ならモニターの Q から(変数を残し、画面はそのままでプロンプトを出す)
b_warm:
        lda #0                  ; C を覚える(b_sys はスタックを空にする)
        rol
        sta bt1
        jsr b_sys
        lda bmagic
        cmp #BMAGIC1
        bne b_cold
        lda bmagic+1
        cmp #BMAGIC2
        bne b_cold
        jsr val_restore         ; VAL の途中でリセットされたら、0にしたバイトを戻す(fix_program の前に)
        lda vartab              ; プログラムの終わり(fix_program が作り直す前)
        pha
        lda vartab+1
        pha
        jsr fix_program         ; プログラムが壊れていれば消す
        lda bt1
        bne bw_q
        pla
        pla
        jsr clearc
        jsr b_banner
        jmp ready
bw_q:
        ; 変数を残すのは、メモリの使い方の記録に矛盾がないときだけ
        ;   vartab が変わっていない、vartab <= arytab <= strend <= fretop <= STRTOP($7FFF)
        pla
        cmp vartab+1
        bne bw_clr1
        pla
        cmp vartab
        bne bw_clr
        sec
        lda arytab
        sbc vartab
        lda arytab+1
        sbc vartab+1
        bcc bw_clr
        sec
        lda strend
        sbc arytab
        lda strend+1
        sbc arytab+1
        bcc bw_clr
        sec
        lda fretop
        sbc strend
        lda fretop+1
        sbc strend+1
        bcc bw_clr
        lda fretop+1            ; fretop <= $7FFF なら上位バイトの最上位ビットが0
        bmi bw_clr
bw_ok:
        stz temppt              ; 一時文字列だけ捨てる
        jmp ready
bw_clr1:
        pla
bw_clr:
        jsr clearc
        jmp ready

b_banner:
        jsr BIOS_CLS
        jsr strout_inline
        .byte "PX-65 BASIC 0.11", K_RET, 0
        rts

; 割り込みなどを BASIC 用にする(スタックも空にする)
b_sys:
        pla                     ; 戻り先
        tax
        pla
        tay
        sei
        cld
        stx bt0
        ldx #$FF
        txs
        phy
        ldx bt0
        phx
        lda NMIVEC              ; モニターの NMI 処理を覚えておく(CALL 中の BREAK 用)
        cmp #<b_nmi
        bne bs_1
        lda NMIVEC+1
        cmp #>b_nmi
        beq bs_2
bs_1:
        lda NMIVEC
        sta monnmi
        lda NMIVEC+1
        sta monnmi+1
bs_2:
        lda #<b_nmi
        sta NMIVEC
        lda #>b_nmi
        sta NMIVEC+1
        stz bstate
        stz brkflag
        stz contok
        stz calcmode            ; 起動したときと、モニターから戻ったときは計算モードをやめる
        stz TAPE_CTRL
        lda #$81
        sta TIMER_CTRL
        lda LCD_CTRL
        ora #$01
        sta LCD_CTRL
        lda #ANN_BUSY
        trb LCD_ANN
        jsr show_angle
        cli
        rts

; 角度の単位の表示(DEG か RAD)を点ける
show_angle:
        lda #ANN_DEG+ANN_RAD
        trb LCD_ANN
        lda #ANN_RAD
        ldx angmode
        beq sa_1
        lda #ANN_DEG
sa_1:
        tsb LCD_ANN
        rts

; ===================================================================
; 入力待ち
; ===================================================================

; ready: スタックを空にしてプロンプトへ(FOR/GOSUB も消える)
ready:
        ldx #$FF
        txs
        stz contok
; ready_keep: スタックはそのまま(STOP、BREAK の後。CONT で続けられるように)
ready_keep:
        cld
        jsr val_restore         ; VAL がエラーで抜けたら、0にしたバイトを戻す
        cli
        stz dimflg
        stz bstate
        stz brkflag
        lda #$FF
        sta curlin
        sta curlin+1
        lda #ANN_BUSY+ANN_RUN   ; 液晶の BUSY と RUN を消す
        trb LCD_ANN
main_loop:
        jsr crlf_if
        lda calcmode            ; 計算モードのプロンプトは C>
        beq ml_1
        lda #4                  ; C> で入力を待っている(ここで BREAK なら計算モードをやめる)
        sta bstate
        lda #'C'
        jsr BIOS_CHROUT
ml_1:
        lda #'>'
        jsr BIOS_CHROUT
        jsr BIOS_GETLINE
main_line:
        jsr line_setup
        lda calcmode
        bne main_calc
main_prog:
        jsr chrget
        bcs main_direct
        jsr linget              ; 行番号があればプログラムに入れる
        jsr store_line
        ldx #$FF                ; プログラムが変わったので FOR/GOSUB は消す
        txs
        stz contok
        bra main_loop
main_direct:
        beq main_loop           ; 空の行
        lda #1
        sta bstate
        tsx
        stx framesp
        stz temppt
        jsr chrgot
        jsr exec_stmt
        jmp newstt

; EDIT で直した行: 計算モードでも、いつもの行として扱う(行番号があればプログラムに入れる)
main_edit:
        jsr line_setup
        bra main_prog

; 入力行をトークンにして、txtptr をその前に置く
line_setup:
        jsr tokenize
        lda #<(LINEBUF-1)
        sta txtptr
        lda #>(LINEBUF-1)
        sta txtptr+1
        rts

; 計算モードの1行。行番号は付けられない(数で始まる行も式)
;   命令で始まる行: いつもの直接実行。「変数=」で始まる行: 代入。それ以外: 式の値を表示する
main_calc:
        jsr chrget
        bne mc_1
        jmp main_loop           ; 空の行
mc_1:
        lda #1
        sta bstate
        tsx
        stx framesp
        stz temppt
        jsr chrgot
        bcc mc_print            ; 数字で始まる
        cmp #$80
        bcs mc_tok
        jsr isletter
        bcc mc_print            ; ( - " . など
        jsr is_assign
        bcs mc_stmt
mc_print:
        jsr st_print
        jmp newstt
mc_tok:
        cmp #TK_TO              ; TK_END-TK_ELSE は命令
        bcc mc_stmt
        cmp #TK_RENUM           ; NOT、関数、PI など: 式
        bcc mc_print
mc_stmt:
        jsr chrgot
        jsr exec_stmt
        jmp newstt

; いまの位置から「変数名 [(…)] =」が続けば C=1(代入の文)。txtptr は変えない
is_assign:
        ldy #0
ia_name:
        jsr ia_next             ; 名前の2文字目から: 英字と数字
        jsr isletter
        bcs ia_name
        cmp #'0'
        bcc ia_1
        cmp #'9'+1
        bcc ia_name
ia_1:
        cmp #'$'
        bne ia_2
        jsr ia_next
ia_2:
        cmp #'('                ; 添字: 対応する ) まで飛ばす
        bne ia_4
        ldx #1
ia_3:
        jsr ia_next
        beq ia_no               ; 行の終わり
        cmp #'"'                ; 文字列の中の ( ) は数えない
        bne ia_3q
ia_3s:
        iny
        lda (txtptr),Y
        beq ia_no
        cmp #'"'
        bne ia_3s
        bra ia_3
ia_3q:
        cmp #'('
        bne ia_3a
        inx
ia_3a:
        cmp #')'
        bne ia_3
        dex
        bne ia_3
        jsr ia_next
ia_4:
        cmp #'='
        beq ia_yes
ia_no:
        clc
        rts
ia_yes:
        sec
        rts
; 次の文字(空白は飛ばす)。A = 文字、Z=1 なら行の終わり
ia_next:
        iny
        lda (txtptr),Y
        cmp #' '
        beq ia_next
        cmp #0
        rts

; 改行(行の途中にいるときだけ)
crlf_if:
        lda cur_x
        beq ci_1
crlf:
        lda #K_RET
        jmp BIOS_CHROUT
ci_1:
        rts

; ===================================================================
; 1文字読む
; ===================================================================

; chrget: 次の文字へ進んで読む。chrgot: いまの文字を読む。どちらも空白は飛ばす。
; A = 文字。Z=1 なら文の終わり(0、:、ELSE)。C=0 なら数字
chrget:
        inc txtptr
        bne chrgot
        inc txtptr+1
chrgot:
        ldy #0
        lda (txtptr),Y
        cmp #' '
        beq chrget
        cmp #':'
        beq cg_done             ; Z=1, C=1
        bcs cg_hi
        sec                     ; 数字なら C=0、0 なら Z=1
        sbc #'0'
        sec
        sbc #$D0
cg_done:
        rts
cg_hi:
        cmp #TK_ELSE            ; ELSE も文の終わり(Z=1, C=1)
        beq cg_done
        cmp #0                  ; Z=0, C=1
        rts

; いまの文字が A でなければ SN エラー。同じなら次へ進む
synchr:
        ldy #0
        cmp (txtptr),Y
        bne syn_err
        jmp chrget
syn_err:
        jmp err_sn

; "," "(" ")" を読む
chkcom:
        lda #','
        bra syn_ch
chkopen:
        lda #'('
        bra syn_ch
chkclose:
        lda #')'
syn_ch:
        pha
        jsr chrgot
        pla
        bra synchr

; ===================================================================
; トークン化
; ===================================================================

; LINEBUF(LINELEN 文字)のキーワードをトークンにして、0 で終わらせる。
; " の中、DATA の後(: まで)、REM の後はそのまま。それ以外の英小文字は大文字にする
tokenize:
        ldx #0                  ; 読む位置
        ldy #0                  ; 書く位置
        stz bt5                 ; 0: ふつう、2: DATA の後、3: REM の後
        stz bt6                 ; " の中なら1
tk_loop:
        cpx LINELEN
        bcc *+5
        jmp tok_end
        lda bt5
        cmp #3
        beq tk_copy             ; REM の後
        lda LINEBUF,X
        cmp #'"'
        bne tk_2
        lda bt6
        eor #1
        sta bt6
        bra tk_copy
tk_2:
        lda bt6
        bne tk_copy             ; " の中
        lda bt5
        cmp #2
        bne tk_3
        lda LINEBUF,X           ; DATA の後: : で終わり
        cmp #':'
        bne tk_copy
        stz bt5
        bra tk_copy
tk_3:
        lda LINEBUF,X
        cmp #'?'
        bne tk_4
        lda #TK_PRINT
        bra tk_put1
tk_4:
        cmp #$27                ; ' は REM
        bne tk_5
        lda #3
        sta bt5
        lda #TK_REM
        bra tk_put1
tk_5:
        jsr toupper
        cmp #'A'
        bcc tk_put
        cmp #'Z'+1
        bcs tk_put
        sty bt4                 ; 英字: キーワードを探す
        jsr kw_match
        ldy bt4
        bcc tk_letter
        sta LINEBUF,Y           ; トークン(X は進んでいる)
        iny
        cmp #TK_REM
        beq tok_rem
        cmp #TK_DATA
        bne tk_loop
        lda #2
        sta bt5
        bra tk_loop
tok_rem:
        lda #3
        sta bt5
        bra tk_loop
tk_letter:
        lda LINEBUF,X
        jsr toupper
tk_put:
        sta LINEBUF,Y
        iny
        inx
        jmp tk_loop
tk_put1:
        sta LINEBUF,Y
        iny
        inx
        jmp tk_loop
tk_copy:
        lda LINEBUF,X
        sta LINEBUF,Y
        iny
        inx
        jmp tk_loop
tok_end:
        lda #0
        sta LINEBUF,Y
        rts

; LINEBUF の X の位置からキーワードを探す。見つかれば C=1、A = トークン、X は進む
kw_match:
        lda #<kwtab
        sta index1
        lda #>kwtab
        sta index1+1
        lda #$80
        sta bt1                 ; トークン
        stx bt2                 ; 始めの位置
km_word:
        ldy #0
        lda (index1),Y
        beq km_none
km_char:
        lda (index1),Y
        and #$7F
        sta bt3
        lda LINEBUF,X
        jsr toupper
        cmp bt3
        bne km_next
        lda (index1),Y
        bmi km_ok
        iny
        inx
        cpx LINELEN             ; 入力の終わりを越えたら不一致
        bcc km_char
km_next:
        ldy #0                  ; 次のキーワードへ
kmn_1:
        lda (index1),Y
        iny
        asl
        bcc kmn_1
        tya
        clc
        adc index1
        sta index1
        bcc kmn_2
        inc index1+1
kmn_2:
        inc bt1
        ldx bt2
        bra km_word
km_ok:
        inx
        lda bt1
        sec
        rts
km_none:
        ldx bt2
        clc
        rts

toupper:
        cmp #'a'
        bcc tu_1
        cmp #'z'+1
        bcs tu_1
        and #$DF
tu_1:
        rts

; ===================================================================
; 行番号とプログラムの行
; ===================================================================

; txtptr の数字を行番号として読み、linnum に置く(0-63999)。数字の次の文字で止まる
linget:
        stz linnum
        stz linnum+1
lg_1:
        bcs lg_done             ; 数字でない
        and #$0F
        pha
        lda linnum+1            ; 6400 以上に10をかけると 63999 を超える
        cmp #$19
        bcs lg_err
        lda linnum              ; linnum × 10 = (×4 + ×1) × 2
        sta bt0
        lda linnum+1
        sta bt1
        asl linnum
        rol linnum+1
        asl linnum
        rol linnum+1
        clc
        lda linnum
        adc bt0
        sta linnum
        lda linnum+1
        adc bt1
        sta linnum+1
        asl linnum
        rol linnum+1
        pla
        clc
        adc linnum
        sta linnum
        bcc lg_2
        inc linnum+1
lg_2:
        jsr chrget
        bra lg_1
lg_err:
        pla
        jmp err_sn
lg_done:
        rts

; linnum の行を探す。lowtr = その行か、それより大きい最初の行(なければ終わりの印)。
; ちょうどその行があれば C=1
fndlin:
        lda #<PRGSTART
        sta lowtr
        lda #>PRGSTART
        sta lowtr+1
fl_1:
        ldy #1
        lda (lowtr),Y
        beq fl_no               ; 終わり
        ldy #3
        lda (lowtr),Y
        cmp linnum+1
        bcc fl_next
        bne fl_no
        dey
        lda (lowtr),Y
        cmp linnum
        bcc fl_next
        bne fl_no
        sec
        rts
fl_next:
        ldy #0
        lda (lowtr),Y
        tax
        iny
        lda (lowtr),Y
        sta lowtr+1
        stx lowtr
        bra fl_1
fl_no:
        clc
        rts

; 入力した行(linnum と、txtptr からの本文)をプログラムに入れる。本文が空なら消す
store_line:
        ldy #0                  ; 本文の長さ
sl_len:
        lda (txtptr),Y
        beq sl_len2
        iny
        bra sl_len
sl_len2:
        sty bt6                 ; 本文の長さ
        jsr fndlin
        bcc sl_ins
        ; 同じ番号の行を消す: [次の行, vartab) を lowtr へ
        ldy #0
        lda (lowtr),Y
        sta srcp
        iny
        lda (lowtr),Y
        sta srcp+1
        lda lowtr
        sta dest
        lda lowtr+1
        sta dest+1
        sec
        lda vartab
        sbc srcp
        sta movlen
        lda vartab+1
        sbc srcp+1
        sta movlen+1
        sec                     ; 消す長さ(move_down は srcp を進めるので、先に求める)
        lda srcp
        sbc lowtr
        sta bt0
        lda srcp+1
        sbc lowtr+1
        sta bt1
        jsr move_down
        sec                     ; vartab -= 消した長さ
        lda vartab
        sbc bt0
        sta vartab
        lda vartab+1
        sbc bt1
        sta vartab+1
sl_ins:
        lda bt6
        beq sl_done             ; 本文が空: 消すだけ
        ; 新しい行の長さ = 4 + 本文 + 1
        clc
        lda bt6
        adc #5
        sta bt0
        lda #0
        sta bt1
        ; 入るか: vartab + 長さ + 256 <= MEMSIZ
        clc
        lda vartab
        adc bt0
        sta bt2
        lda vartab+1
        adc #1
        cmp #>MEMSIZ
        bcc sl_room
        jmp err_om
sl_room:
        ; [lowtr, vartab) を長さ分だけ上へ
        lda lowtr
        sta srcp
        lda lowtr+1
        sta srcp+1
        clc
        lda lowtr
        adc bt0
        sta dest
        lda lowtr+1
        adc #0
        sta dest+1
        sec
        lda vartab
        sbc lowtr
        sta movlen
        lda vartab+1
        sbc lowtr+1
        sta movlen+1
        jsr move_up
        clc
        lda vartab
        adc bt0
        sta vartab
        bcc sl_v1
        inc vartab+1
sl_v1:
        ; 見出し(つなぎは後で直す)と本文
        ldy #0
        lda #$FF
        sta (lowtr),Y
        iny
        sta (lowtr),Y
        iny
        lda linnum
        sta (lowtr),Y
        iny
        lda linnum+1
        sta (lowtr),Y
        clc                     ; dest = lowtr + 4
        lda lowtr
        adc #4
        sta dest
        lda lowtr+1
        adc #0
        sta dest+1
        ldy #0
sl_copy:
        lda (txtptr),Y
        sta (dest),Y
        beq sl_done
        iny
        bra sl_copy
sl_done:
        jsr relink
        jmp clearc

; 行のつなぎ(次の行の番地)を作り直す
relink:
        lda #<PRGSTART
        sta index1
        lda #>PRGSTART
        sta index1+1
rl_1:
        ldy #1
        lda (index1),Y
        beq rl_done             ; 終わりの印(つなぎが0)
        ldy #4                  ; 本文の終わりの 0 を探す
rl_2:
        lda (index1),Y
        beq rl_3
        iny
        bra rl_2
rl_3:
        iny                     ; 次の行 = index1 + Y
        tya
        clc
        adc index1
        sta bt0
        lda index1+1
        adc #0
        sta bt1
        ldy #0
        lda bt0
        sta (index1),Y
        iny
        lda bt1
        sta (index1),Y
        lda bt0
        sta index1
        lda bt1
        sta index1+1
        bra rl_1
rl_done:
        rts

; ===================================================================
; メモリの転送
; ===================================================================

; srcp から dest へ movlen バイト(dest < srcp のとき。前から写す)。
; 256バイトを超えると srcp と dest の上位バイトが進むので、呼ぶ側は後で使わないこと
move_down:
        ldy #0
        ldx movlen+1
        beq md_2
md_1:
        lda (srcp),Y
        sta (dest),Y
        iny
        bne md_1
        inc srcp+1
        inc dest+1
        dex
        bne md_1
md_2:
        ldx movlen
        beq md_4
md_3:
        lda (srcp),Y
        sta (dest),Y
        iny
        dex
        bne md_3
md_4:
        rts

; srcp から dest へ movlen バイト(dest > srcp のとき。後ろから写す)
move_up:
        lda movlen
        ora movlen+1
        beq mu_done
        clc                     ; 最後のページの先頭に合わせる
        lda srcp+1
        adc movlen+1
        sta srcp+1
        clc
        lda dest+1
        adc movlen+1
        sta dest+1
        ldy movlen
        beq mu_page
mu_1:
        dey
        lda (srcp),Y
        sta (dest),Y
        cpy #0
        bne mu_1
mu_page:
        ldx movlen+1
        beq mu_done
mu_2:
        dec srcp+1
        dec dest+1
mu_3:
        dey
        lda (srcp),Y
        sta (dest),Y
        cpy #0
        bne mu_3
        dex
        bne mu_2
mu_done:
        rts

; ===================================================================
; NEW, CLEAR
; ===================================================================

; プログラムを空にする
b_new_mem:
        lda #0
        sta PRGSTART-1
        sta PRGSTART
        sta PRGSTART+1
        lda #<(PRGSTART+2)
        sta vartab
        lda #>(PRGSTART+2)
        sta vartab+1
        stz contok
        ; そのまま clearc へ

; 変数を消す
clearc:
        lda vartab
        sta arytab
        sta strend
        lda vartab+1
        sta arytab+1
        sta strend+1
        lda #<STRTOP
        sta fretop
        lda #>STRTOP
        sta fretop+1
        stz temppt
        jmp restore_data

; プログラムのつなぎをたどって終わりを探し、vartab を決める。壊れていれば空にする
fix_program:
        lda #0
        sta PRGSTART-1
        lda #<PRGSTART
        sta index1
        lda #>PRGSTART
        sta index1+1
fp_1:
        ldy #1
        lda (index1),Y
        beq fp_end
        cmp #>MEMSIZ            ; つなぎが RAM の外なら壊れている
        bcs fp_bad
        tax
        dey
        lda (index1),Y
        cpx index1+1            ; つなぎは前へは進まない
        bcc fp_bad
        bne fp_2
        cmp index1
        bcc fp_bad
        beq fp_bad
fp_2:
        sta index1
        stx index1+1
        bra fp_1
fp_end:
        clc
        lda index1
        adc #2
        sta vartab
        lda index1+1
        adc #0
        sta vartab+1
        rts
fp_bad:
        jmp b_new_mem

; ===================================================================
; 実行
; ===================================================================

; 文を順に実行する。txtptr はいまの文の終わり(: か 0)を指す
newstt:
        tsx
        stx framesp
        stz temppt
        lda curlin+1            ; プログラムを実行しているあいだは液晶の RUN を点ける
        cmp #$FF
        beq ns_0
        lda #ANN_RUN
        tsb LCD_ANN
ns_0:
        lda brkflag
        beq ns_1
        jmp do_break
ns_1:
        ldy #0
        lda (txtptr),Y
        beq ns_eol
        cmp #':'
        beq ns_stmt
        cmp #TK_ELSE            ; THEN の後の文の終わりの ELSE: 行の残りを飛ばす
        beq ns_skip
        jmp err_sn
ns_skip:
        jsr skip_line
        bra newstt
ns_eol:
        lda curlin+1            ; 直接実行の行が終わった
        cmp #$FF
        bne ns_next
        lda curlin
        cmp #$FF
        bne ns_next
        jmp ready_keep
ns_next:
        ldy #2                  ; 次の行の見出し(0 の次がつなぎ)
        lda (txtptr),Y
        bne ns_line
        jmp end_prog            ; プログラムの終わり
ns_line:
        ldy #3
        lda (txtptr),Y
        sta curlin
        iny
        lda (txtptr),Y
        sta curlin+1
        clc
        lda txtptr
        adc #4
        sta txtptr
        bcc ns_stmt
        inc txtptr+1
ns_stmt:
        jsr chrget
        jsr exec_stmt
        jmp newstt

; 1つの文を実行する。A = 文の最初の文字(chrget の後)
exec_stmt:
        beq es_empty
        cmp #TK_END
        bcc es_let
        cmp #TK_ELSE+1
        bcs es_sn
        sec
        sbc #TK_END
        asl
        tax
        jsr chrget              ; 命令の次の文字へ
        jmp (stmt_table,X)
es_let:
        jmp st_let
es_sn:
        cmp #TK_RENUM
        bne es_sn2
        jsr chrget
        jmp st_renum
es_sn2:
        cmp #TK_CALC
        bne es_sn3
        jsr chrget
        lda #1                  ; CALC: 計算モードにする(プロンプトが C> になる)
        sta calcmode
        rts
es_sn3:
        jmp err_sn
es_empty:
        rts

; 行の残りを飛ばす(txtptr を行の終わりの 0 へ)
skip_line:
        ldy #0
skl_1:
        lda (txtptr),Y
        beq skl_2
        iny
        bne skl_1
skl_2:
        tya
        clc
        adc txtptr
        sta txtptr
        bcc skl_3
        inc txtptr+1
skl_3:
        rts

; 文の残りを飛ばす(: か 0 まで。" の中の : は飛ばす)
skip_stmt:
        ldy #0
        stz bt0
sks_1:
        lda (txtptr),Y
        beq sks_2
        cmp #'"'
        bne sks_3
        lda bt0
        eor #1
        sta bt0
        bra sks_4
sks_3:
        cmp #':'
        bne sks_4
        ldx bt0
        beq sks_2
sks_4:
        iny
        bne sks_1
sks_2:
        tya
        clc
        adc txtptr
        sta txtptr
        bcc sks_5
        inc txtptr+1
sks_5:
        rts

; プログラムの最後まで来た
end_prog:
        jmp ready

; BREAK キーで止まった
do_break:
        stz brkflag
        jsr save_cont
        jsr crlf_if
        jsr strout_inline
        .byte "BREAK", 0
        jsr in_line
        jmp ready_keep

; CONT で続けられるように、いまの位置を覚える(直接実行のときは続けられない)
save_cont:
        lda curlin+1
        and curlin
        cmp #$FF
        beq sc_no
        lda txtptr
        sta oldtxt
        lda txtptr+1
        sta oldtxt+1
        lda curlin
        sta oldlin
        lda curlin+1
        sta oldlin+1
        lda #1
        sta contok
        rts
sc_no:
        stz contok
        rts

; " IN 行番号"(プログラムの実行中なら)
in_line:
        lda curlin+1
        and curlin
        cmp #$FF
        beq il_1
        jsr strout_inline
        .byte " IN ", 0
        lda curlin
        ldy curlin+1
        jmp linprt
il_1:
        rts

; ===================================================================
; BREAK キー(NMI)
; ===================================================================
b_nmi:
        pha
        lda bstate
        cmp #1
        beq bn_flag             ; 実行中: 文の区切りで止める
        cmp #3
        beq bn_mon              ; CALL 中: モニターに任せる
        ; 入力を待っているところ: すぐにやめる
        pla
        cld
        ldx #$FF
        txs
        stz TAPE_CTRL
        jsr BIOS_CUROFF
        lda bstate
        cmp #2
        beq bn_input
        cmp #4
        bne bn_ready
        stz calcmode            ; C> で BREAK: 計算モードをやめる(EDIT の取り消しなどではやめない)
bn_ready:
        jsr crlf_if
        jmp ready
bn_input:
        jsr crlf_if             ; INPUT の途中: BREAK IN 行番号
        jsr strout_inline
        .byte "BREAK", 0
        jsr in_line
        jmp ready
bn_flag:
        lda #1
        sta brkflag
        pla
        rti
bn_mon:
        pla
        jmp (monnmi)

; ===================================================================
; エラー
; ===================================================================

; X = エラーの番号。メッセージを出してプロンプトに戻る
b_error:
        cld
        stx errnum
        stz TAPE_CTRL
        jsr BIOS_CUROFF
        jsr crlf_if
        lda #'?'
        jsr BIOS_CHROUT
        lda errnum
        asl
        tax
        lda err_codes,X
        jsr BIOS_CHROUT
        lda err_codes+1,X
        jsr BIOS_CHROUT
        jsr strout_inline
        .byte " ERROR", 0
        jsr in_line
        jmp ready

err_codes:
        .byte "SNOV/0FCULOMTMBSDDLSNFRGODCNIDNTTPTF"

err_sn:
        ldx #EN_SN
        jmp b_error
err_om:
        ldx #EN_OM
        jmp b_error
err_tm:
        ldx #EN_TM
        jmp b_error
err_ul:
        ldx #EN_UL
        jmp b_error

; ===================================================================
; 表示
; ===================================================================

; JSR の直後の文字列(0 終わり)を表示して、その後ろに戻る
strout_inline:
        pla
        sta strp
        pla
        sta strp+1
soi_1:
        inc strp
        bne soi_2
        inc strp+1
soi_2:
        lda (strp)
        beq soi_3
        jsr BIOS_CHROUT
        bra soi_1
soi_3:
        lda strp+1
        pha
        lda strp
        pha
        rts

; fbuffr を表示する(先頭の符号の空白は出さない)
out_fbuf_nosign:
        ldx #1
        lda fbuffr
        cmp #' '
        beq ofb_1
        ldx #0
ofb_1:
        lda fbuffr,X
        beq ofb_2
        jsr BIOS_CHROUT
        inx
        bra ofb_1
ofb_2:
        rts

; A(下位)Y(上位)を符号なし10進数で表示する
linprt:
        jsr fac_u16
        jsr fout
        jmp out_fbuf_nosign

; 空きバイト数を A(下位)Y(上位)に
fre_bytes:
        sec
        lda fretop
        sbc strend
        tax
        lda fretop+1
        sbc strend+1
        tay
        txa
        rts
