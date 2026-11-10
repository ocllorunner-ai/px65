; PX-65 BASIC: 命令
;
; 命令の処理は、txtptr が命令のトークンの次の文字を指し(chrget 済み)、A にその文字が
; 入った状態で呼ばれる。終わったら文の終わり(: か 0)を指して rts する。

; 命令の表(TK_END から TK_ELSE の順)
stmt_table:
        .word st_end, st_for, st_next, st_data, st_input, st_dim, st_read, st_let
        .word st_goto, st_run, st_if, st_restore, st_gosub, st_return, st_rem, st_stop
        .word st_on, st_wait, st_load, st_save, st_poke, st_print, st_cont, st_list
        .word st_clear, st_new, st_cls, st_locate, st_pset, st_preset, st_line, st_circle
        .word st_beep, st_deg, st_rad, st_randomize, st_call, st_files, st_mon, st_edit
        .word st_delete, st_rem

; FOR の積み上げ(スタック上、印のバイトから):
;   +0 TK_FOR  +1,2 変数の番地  +3-7 STEP  +8-12 終わりの値  +13,14 行番号  +15,16 位置
FORSIZE    = 17
; GOSUB の積み上げ: +0 TK_GOSUB  +1,2 行番号  +3,4 位置
GOSUBSIZE  = 5

; ===================================================================
; 流れ
; ===================================================================

st_end:
        jmp ready

st_stop:
        ldx framesp
        txs
        jsr save_cont
        jsr crlf_if
        jsr strout_inline
        .byte "BREAK", 0
        jsr in_line
        jmp ready_keep

st_cont:
        lda contok
        bne scn_1
        ldx #EN_CN
        jmp b_error
scn_1:
        stz contok
        ldx framesp
        txs
        lda oldtxt
        sta txtptr
        lda oldtxt+1
        sta txtptr+1
        lda oldlin
        sta curlin
        lda oldlin+1
        sta curlin+1
        lda #1
        sta bstate
        jmp newstt

st_new:
        jsr b_new_mem
        jmp ready

st_clear:
        jsr clearc
        ldx #$FF
        txs
        jmp newstt

st_run:
        php
        jsr clearc
        stz contok
        stz brkflag
        lda #1
        sta bstate
        plp
        bne sr_line             ; 行番号がある
        lda #<(PRGSTART-1)
        sta txtptr
        lda #>(PRGSTART-1)
        sta txtptr+1
        stz curlin
        stz curlin+1
        ldx #$FF
        txs
        jmp newstt
sr_line:
        jsr chrgot
        jsr st_goto
        ldx #$FF
        txs
        jmp newstt

; GOTO 行番号
st_goto:
        bcs sg_sn               ; 数字でない
        jsr linget
goto_lin:
        jsr fndlin
        bcs sg_1
        jmp err_ul
sg_1:
        sec                     ; txtptr = 行の直前(前の行の終わりの 0)
        lda lowtr
        sbc #1
        sta txtptr
        lda lowtr+1
        sbc #0
        sta txtptr+1
        ldy #2                  ; 行番号は飛び先の行のもの(BREAK の表示、直接実行から進むため)
        lda (lowtr),Y
        sta curlin
        iny
        lda (lowtr),Y
        sta curlin+1
        rts
sg_sn:
        jmp err_sn

; GOSUB 行番号
st_gosub:
        bcs sg_sn
        jsr linget
; linnum の行へ GOSUB する(戻る位置は txtptr)
gosub_lin:
        pla                     ; 戻り先を一時どける
        sta bt6
        pla
        sta bt7
        lda txtptr+1            ; 積み上げ: 位置、行番号、印
        pha
        lda txtptr
        pha
        lda curlin+1
        pha
        lda curlin
        pha
        lda #TK_GOSUB
        pha
        jsr stack_check
        lda bt7
        pha
        lda bt6
        pha
        jmp goto_lin

; スタックが残り少なければ OM エラー
stack_check:
        tsx
        cpx #$40
        bcc sc_om
        rts
sc_om:
        jmp err_om

st_return:
        tsx                     ; 戻り先の上から GOSUB の印を探す(途中の FOR は捨てる)
        inx
        inx
sr_1:
        cpx #$FF
        bcs sr_rg
        lda $0101,X
        cmp #TK_GOSUB
        beq sr_found
        cmp #TK_FOR
        bne sr_rg
        txa
        clc
        adc #FORSIZE
        tax
        bcc sr_1
sr_rg:
        ldx #EN_RG
        jmp b_error
sr_found:
        lda $0102,X
        sta curlin
        lda $0103,X
        sta curlin+1
        lda $0104,X
        sta txtptr
        lda $0105,X
        sta txtptr+1
        txa
        clc
        adc #GOSUBSIZE
        tax
        txs
        jmp newstt

; ON 式 GOTO/GOSUB 行番号, 行番号, ...
st_on:
        jsr frmnum
        jsr getbyte
        sta bt4
        jsr chrgot
        cmp #TK_GOTO
        beq so_1
        cmp #TK_GOSUB
        beq so_1
        jmp err_sn
so_1:
        pha                     ; GOTO か GOSUB
        jsr chrget
so_2:
        dec bt4
        beq so_go               ; この行番号
        bmi so_skip             ; 0 だった: 何もしない
        jsr linget              ; 行番号を飛ばす
        jsr chrgot
        cmp #','
        bne so_none             ; 足りない: 何もしない
        jsr chrget
        bra so_2
so_go:
        pla
        cmp #TK_GOSUB
        bne so_goto
        jsr chrgot              ; 行番号を読んで、文の終わりから戻るようにする
        bcs so_sn
        jsr linget
        jsr skip_stmt
        jmp gosub_lin
so_sn:
        jmp err_sn
so_goto:
        jsr chrgot
        jmp st_goto
so_skip:
so_none:
        pla
        jmp skip_stmt

; IF 式 THEN 行番号か文 [ELSE 行番号か文]、IF 式 GOTO 行番号
st_if:
        jsr frmevl
        lda valtyp
        beq si_num
        jsr fac_str             ; 文字列なら空でなければ真
        pha
        jsr free_fac
        pla
        bra si_test
si_num:
        lda fac_e
si_test:
        tax
        jsr chrgot
        cmp #TK_GOTO
        beq si_kw
        cmp #TK_THEN
        beq si_kw
        jmp err_sn
si_kw:
        cpx #0
        beq si_false
        cmp #TK_GOTO
        bne si_then
        jsr chrget
        jmp st_goto
si_then:
        jsr chrget
        bcc si_goto             ; THEN 行番号
        jmp exec_stmt
si_goto:
        jmp st_goto
si_false:
        ; 行の中の、この IF に対応する ELSE を探す(" の中は飛ばす)。
        ; 途中の IF の数を数え、ELSE はいちばん近い、まだ ELSE のない IF に対応させる
        ldy #0
        stz bt0                 ; " の中なら 1
        stz bt1                 ; 途中の IF の数
sif_1:
        lda (txtptr),Y
        beq sif_none
        cmp #'"'
        bne sif_2
        lda bt0
        eor #1
        sta bt0
        bra sif_3
sif_2:
        ldx bt0
        bne sif_3
        cmp #TK_IF
        bne sif_2b
        inc bt1
        bra sif_3
sif_2b:
        cmp #TK_ELSE
        bne sif_3
        lda bt1
        beq sif_else
        dec bt1                 ; 途中の IF の ELSE
sif_3:
        iny
        bne sif_1
sif_none:
        jmp skip_line
sif_else:
        tya
        clc
        adc txtptr
        sta txtptr
        bcc sif_4
        inc txtptr+1
sif_4:
        jsr chrget
        bcc si_goto
        jmp exec_stmt

st_rem:
        jmp skip_line

st_data:
        jmp skip_stmt

; FOR 変数 = 初め TO 終わり [STEP 増分]
st_for:
        jsr isletter
        bcs sf_1
        jmp err_sn
sf_1:
        jsr ptrget
        lda valtyp
        beq sf_2
        jmp err_tm
sf_2:
        lda varptr+1            ; 配列の要素は使えない(配列は動くことがあるので)
        cmp arytab+1
        bcc sf_ok
        bne sf_sn
        lda varptr
        cmp arytab
        bcc sf_ok
sf_sn:
        jmp err_sn
sf_ok:
        lda varptr
        sta forpnt
        lda varptr+1
        sta forpnt+1
        lda #'='
        jsr synchr
        jsr frmnum
        lda forpnt
        ldy forpnt+1
        jsr fac_st
        lda #TK_TO
        jsr synchr
        jsr frmnum
        lda #<fpt1              ; 終わりの値
        ldy #>fpt1
        jsr fac_st
        lda #<c_one             ; STEP(なければ 1)
        ldy #>c_one
        jsr fac_ld
        jsr chrgot
        cmp #TK_STEP
        bne sf_3
        jsr chrget
        jsr frmnum
sf_3:
        lda #<fpt2
        ldy #>fpt2
        jsr fac_st
        ; 戻り先をどけて、同じ変数の FOR があれば(その上も)捨てる
        pla
        sta bt6
        pla
        sta bt7
        jsr find_for
        bcc sf_4
        txa                     ; 見つかった: その FOR(とその上)を捨てる
        clc
        adc #FORSIZE
        tax
        txs
sf_4:
        lda txtptr+1            ; 積み上げ
        pha
        lda txtptr
        pha
        lda curlin+1
        pha
        lda curlin
        pha
        ldx #4
sf_5:
        lda fpt1,X              ; 終わりの値
        pha
        dex
        bpl sf_5
        ldx #4
sf_6:
        lda fpt2,X              ; STEP
        pha
        dex
        bpl sf_6
        lda forpnt+1
        pha
        lda forpnt
        pha
        lda #TK_FOR
        pha
        jsr stack_check
        lda bt7
        pha
        lda bt6
        pha
        rts

; スタックの上から、変数 forpnt の FOR を探す(forpnt の上位が0なら、最初の FOR)。
; 見つかれば C=1、X = 印の位置 - 1($0101+X が印)。GOSUB に当たったら見つからない
find_for:
        tsx
        inx                     ; find_for の戻り先を飛ばす
        inx
ff_1:
        cpx #$FF
        bcs ff_no
        lda $0101,X
        cmp #TK_FOR
        bne ff_no
        lda forpnt+1
        beq ff_yes
        lda $0102,X
        cmp forpnt
        bne ff_next
        lda $0103,X
        cmp forpnt+1
        beq ff_yes
ff_next:
        txa
        clc
        adc #FORSIZE
        tax
        bcc ff_1
ff_no:
        clc
        rts
ff_yes:
        sec
        rts

; NEXT [変数 [, 変数 ...]]
st_next:
        pla                     ; 戻り先は使わない(newstt へ直接進む)
        pla
sn_var:
        stz forpnt+1
        jsr chrgot
        beq sn_find
        cmp #','
        beq sn_find
        jsr ptrget
        lda varptr
        sta forpnt
        lda varptr+1
        sta forpnt+1
sn_find:
        jsr find_for
        bcs sn_1
        ldx #EN_NF
        jmp b_error
sn_1:
        txs                     ; この FOR より上を捨てる(印は $0101+X)
        stx bt6
        lda $0102,X             ; 変数 = 変数 + STEP
        sta forpnt
        lda $0103,X
        sta forpnt+1
        lda forpnt
        ldy forpnt+1
        jsr fac_ld
        clc
        lda bt6
        adc #$01+3              ; STEP の番地 = $0101 + X + 3
        ldy #$01
        jsr arg_ld
        jsr fadd
        lda forpnt
        ldy forpnt+1
        jsr fac_st
        ldx bt6
        clc
        txa
        adc #$01+8              ; 終わりの値
        ldy #$01
        jsr arg_ld
        jsr fcmp                ; A = 1(終わり > 変数)、0、$FF
        ldx bt6
        ldy $0101+4,X           ; STEP の符号(+4 = 仮数の最初のバイトの bit7)
        bmi sn_neg
        cmp #$FF
        beq sn_done             ; 変数 > 終わり
        bra sn_loop
sn_neg:
        cmp #1
        beq sn_done             ; 変数 < 終わり
sn_loop:
        lda $0101+13,X          ; 続ける: FOR の次へ
        sta curlin
        lda $0101+14,X
        sta curlin+1
        lda $0101+15,X
        sta txtptr
        lda $0101+16,X
        sta txtptr+1
        jmp newstt
sn_done:
        txa                     ; この FOR を捨てる
        clc
        adc #FORSIZE
        tax
        txs
        jsr chrgot
        cmp #','
        bne sn_end
        jsr chrget
        jmp sn_var
sn_end:
        jmp newstt

; ===================================================================
; 代入
; ===================================================================

st_let:
        jsr isletter
        bcs sl_1
        jmp err_sn
sl_1:
        jsr ptrget
        lda varptr
        sta forpnt
        lda varptr+1
        sta forpnt+1
        lda valtyp
        pha
        lda #'='
        jsr synchr
        jsr frmevl
        pla
        cmp valtyp
        beq sl_2
        jmp err_tm
sl_2:
        jmp let_value

st_dim:
        jsr isletter
        bcs sd_1
        jmp err_sn
sd_1:
        lda #1
        sta dimflg
        jsr ptrget
        stz dimflg
        jsr chrgot
        cmp #','
        bne sd_done
        jsr chrget
        bra st_dim
sd_done:
        rts

; ===================================================================
; PRINT
; ===================================================================

st_print:
        jsr chrgot
        beq pr_crlf
pr_1:
        cmp #';'
        beq pr_semi
        cmp #','
        beq pr_comma
        cmp #TK_TAB
        beq pr_tab
        cmp #TK_SPC
        beq pr_spc
        jsr frmevl
        jsr print_value
        jsr chrgot
        beq pr_crlf
        bra pr_1
pr_semi:
        jsr chrget
        beq pr_done
        bra pr_1
pr_comma:
        lda cur_x               ; 次の8桁の区切りへ
        cmp #8
        bcs pr_c2
pr_c1:
        jsr out_space
        lda cur_x
        cmp #8
        bcc pr_c1
        bra pr_c3
pr_c2:
        jsr crlf
pr_c3:
        jsr chrget
        beq pr_done
        bra pr_1
pr_tab:
        jsr pr_arg
        sta bt0
pr_t1:
        lda cur_x
        cmp bt0
        bcs pr_after
        cmp #COLS
        bcs pr_after
        jsr out_space
        bra pr_t1
pr_spc:
        jsr pr_arg
        tax
        beq pr_after
pr_s1:
        jsr out_space
        dex
        bne pr_s1
pr_after:
        jsr chrgot
        beq pr_crlf
        bra pr_1
pr_crlf:
        jmp crlf
pr_done:
        rts

; TAB( SPC( の引数(トークンに ( が含まれている)
pr_arg:
        jsr chrget
        jsr frmnum
        jsr chkclose
        jmp getbyte

out_space:
        lda #' '
        jmp BIOS_CHROUT

; FAC の値を表示する(数なら後ろに空白)
print_value:
        lda valtyp
        bne pv_str
        jsr fout
        ldx #0
pv_1:
        lda fbuffr,X
        beq pv_2
        jsr BIOS_CHROUT
        inx
        bra pv_1
pv_2:
        jmp out_space
pv_str:
        jsr fac_str
        pha
        jsr free_fac
        pla
        tax
        beq pv_4
        ldy #0
pv_3:
        lda (strp),Y
        jsr BIOS_CHROUT
        iny
        dex
        bne pv_3
pv_4:
        rts

; ===================================================================
; INPUT, READ, DATA
; ===================================================================

dsave      = $03FB          ; 2 INPUT の間、READ の位置を退避
isave      = $03FD          ; 2 INPUT をやり直すときの変数の並びの位置
in_first   = $03FF          ; INPUT: まだ1つも読んでいない
inptr      = datptr         ; INPUT の読む位置(INPUT の間だけ datptr を使う)

st_input:
        lda curlin+1            ; 直接実行ではできない
        and curlin
        cmp #$FF
        bne si_1
        ldx #EN_ID
        jmp b_error
si_1:
        lda datptr
        sta dsave
        lda datptr+1
        sta dsave+1
        jsr chrgot
        cmp #'"'
        bne si_q
        jsr frmevl              ; "見出し"; なら ? を付ける、"見出し", なら付けない
        jsr print_value
        jsr chrgot
        cmp #','
        bne si_p1
        jsr chrget
        bra si_ask
si_p1:
        lda #';'
        jsr synchr
si_q:
        lda #'?'
        jsr BIOS_CHROUT
        jsr out_space
si_ask:
        lda txtptr              ; 変数の並びの始め(やり直しのため)
        sta isave
        lda txtptr+1
        sta isave+1
si_again:
        jsr in_line_read
si_var:
        jsr ptrget
        lda varptr
        sta forpnt
        lda varptr+1
        sta forpnt+1
        jsr swap_ptr            ; txtptr = 入力行
        lda in_first            ; 最初の値なら、行が空でないか
        beq si_v0
        stz in_first
        lda LINEBUF
        bne si_item
        bra si_more
si_v0:
        jsr chrgot              ; 次がなければ ?? で続きを聞く
        bne si_item
si_more:
        jsr swap_ptr
        lda #'?'
        jsr BIOS_CHROUT
        jsr BIOS_CHROUT
        jsr out_space
        jsr in_line_read
        jsr swap_ptr
        stz in_first
        lda LINEBUF
        beq si_more
si_item:
        jsr read_item
        bcs si_redo
        jsr chrgot              ; 値の後は , か行の終わり
        beq si_v1
        cmp #','
        bne si_redo
si_v1:
        jsr swap_ptr
        jsr let_value
        jsr chrgot
        cmp #','
        bne si_end
        jsr chrget
        bra si_var
si_end:
        lda dsave
        sta datptr
        lda dsave+1
        sta datptr+1
        rts
si_redo:
        lda valtyp              ; 文字列の変数なら、read_item が作った一時文字列を捨てる
        beq si_rd1              ; (捨てないと、?REDO のたびに一時文字列がたまって ?OM になる。0.11.13 で修正)
        jsr free_fac
si_rd1:
        jsr swap_ptr            ; 数でないものが入った: やり直し
        jsr crlf_if
        jsr strout_inline
        .byte "?REDO", K_RET, "? ", 0
        lda isave
        sta txtptr
        lda isave+1
        sta txtptr+1
        jmp si_again

; 1行入力して、読む位置(inptr)をその直前にする
in_line_read:
        lda #2
        sta bstate
        jsr BIOS_GETLINE
        lda #1
        sta bstate
        ldx LINELEN
        stz LINEBUF,X
        lda #<(LINEBUF-1)
        sta inptr
        lda #>(LINEBUF-1)
        sta inptr+1
        lda #1
        sta in_first
        rts

; txtptr と datptr(inptr)を入れ替える
swap_ptr:
        ldx txtptr
        lda datptr
        sta txtptr
        stx datptr
        ldx txtptr+1
        lda datptr+1
        sta txtptr+1
        stx datptr+1
        rts

; txtptr の次から、valtyp の型の値を1つ読む(FAC か一時文字列)。
; 文字列: "..." か、, : 0 の前まで。数が読めなければ C=1
read_item:
        jsr chrget
        lda valtyp
        bne ri_str
        jsr chrgot              ; &H なら16進数
        cmp #'&'
        bne ri_dec
        jsr hex_lit
        bcc ri_num
        rts                     ; 書き方の間違い(C=1)
ri_dec:
        jsr fin
ri_num:
        jsr chrgot
        beq ri_ok
        cmp #','
        beq ri_ok
        sec
        rts
ri_ok:
        stz valtyp
        clc
        rts
ri_str:
        jsr chrgot
        ldx #0                  ; 終わりの文字
        cmp #'"'
        bne ri_s1
        ldx #'"'
        inc txtptr              ; " を飛ばす
        bne ri_s1
        inc txtptr+1
ri_s1:
        stx bt0
        ldy #0
ri_s2:
        lda (txtptr),Y
        beq ri_s4
        cpx #0
        bne ri_s3
        cmp #','
        beq ri_s4
        cmp #':'
        beq ri_s4
ri_s3:
        cmp bt0
        beq ri_s4
        iny
        bne ri_s2
ri_s4:
        phy
        tya                     ; 一時文字列(本文の中を指す)
        ldx txtptr
        ldy txtptr+1
        jsr put_temp
        ply
        tya                     ; txtptr を終わりへ
        clc
        adc txtptr
        sta txtptr
        bcc ri_s5
        inc txtptr+1
ri_s5:
        lda bt0                 ; 閉じる " を飛ばす
        beq ri_s6
        lda (txtptr)
        beq ri_s6
        inc txtptr
        bne ri_s6
        inc txtptr+1
ri_s6:
        jsr chrgot
        clc
        rts

; READ 変数 [, 変数 ...]
st_read:
rd_var:
        jsr ptrget
        lda varptr
        sta forpnt
        lda varptr+1
        sta forpnt+1
        jsr data_next           ; 次のデータの直前へ
        jsr swap_ptr            ; txtptr = データ
        jsr read_item
        bcs rd_sn
        jsr chrgot
        beq rd_1
        cmp #','
        bne rd_sn
rd_1:
        jsr swap_ptr
        jsr let_value
        jsr chrgot
        cmp #','
        bne rd_end
        jsr chrget
        bra rd_var
rd_end:
        rts
rd_sn:
        lda datlin              ; DATA の行のエラーにする
        sta curlin
        lda datlin+1
        sta curlin+1
        jmp err_sn

; datptr を次のデータの直前(, か DATA の直後)にする。なければ OD エラー
data_next:
        lda (datptr)
        cmp #','
        bne dn_find
        rts
dn_find:
        ldy #0
dn_1:
        lda (datptr),Y
        beq dn_eol
        cmp #TK_DATA
        beq dn_found
        iny
        bne dn_1
dn_eol:
        ; 行の終わり: 次の行へ
        tya
        clc
        adc datptr
        sta datptr
        bcc dn_2
        inc datptr+1
dn_2:
        ldy #2
        lda (datptr),Y          ; つなぎの上位が0ならプログラムの終わり
        beq dn_od
        ldy #3
        lda (datptr),Y
        sta datlin
        iny
        lda (datptr),Y
        sta datlin+1
        clc
        lda datptr
        adc #5
        sta datptr
        bcc dn_find
        inc datptr+1
        bra dn_find
dn_found:
        tya                     ; datptr = DATA トークン(次の chrget で中身へ)
        clc
        adc datptr
        sta datptr
        bcc dn_3
        inc datptr+1
dn_3:
        rts
dn_od:
        ldx #EN_OD
        jmp b_error

; RESTORE [行番号]
st_restore:
        bcs restore_data
        jsr linget
        jsr fndlin
        bcs sre_1
        jmp err_ul
sre_1:
        sec
        lda lowtr
        sbc #1
        sta datptr
        lda lowtr+1
        sbc #0
        sta datptr+1
        rts
restore_data:
        lda #<(PRGSTART-1)
        sta datptr
        lda #>(PRGSTART-1)
        sta datptr+1
        rts

; ===================================================================
; そのほか
; ===================================================================

; POKE 番地, 値
st_poke:
        jsr frmnum
        jsr getint16
        lda linnum
        pha
        lda linnum+1
        pha
        jsr chkcom
        jsr frmnum
        jsr getbyte
        ply
        sty linnum+1
        ply
        sty linnum
        sta (linnum)
        rts

; CALL 番地(機械語を呼ぶ。RTS で戻る)
st_call:
        jsr frmnum
        jsr getint16
        lda #3
        sta bstate
        lda #>(sca_ret-1)
        pha
        lda #<(sca_ret-1)
        pha
        jmp (linnum)
sca_ret:
        cld
        lda #1
        sta bstate
        rts

; WAIT n(1/64秒単位)
st_wait:
        jsr frmnum
        jsr getint16
        clc                     ; 終わる時刻 = ticks + n
        lda ticks
        adc linnum
        sta bt0
        lda ticks+1
        adc linnum+1
        sta bt1
sw_1:
        lda brkflag
        bne sw_2
        sec
        lda ticks
        sbc bt0
        lda ticks+1
        sbc bt1
        bpl sw_2                ; ticks - 終わり >= 0
        wai
        bra sw_1
sw_2:
        rts

st_cls:
        jmp BIOS_CLS

; LOCATE 桁, 行
st_locate:
        jsr frmnum
        jsr getbyte
        cmp #COLS
        bcs sl_fc
        pha
        jsr chkcom
        jsr frmnum
        jsr getbyte
        cmp #ROWS
        bcs sl_fc
        tay
        plx
        jmp BIOS_LOCATE
sl_fc:
        jmp err_fc

st_deg:
        lda #1
        bra sdr_1
st_rad:
        lda #0
sdr_1:
        sta angmode
        jmp show_angle

st_mon:
        lda #ANN_RUN            ; プログラムの中の MON でも RUN を消す
        trb LCD_ANN
        jmp BIOS_MONENTER

; ===================================================================
; LIST, EDIT, DELETE
; ===================================================================

; LIST [初め][-[終わり]]
st_list:
        jsr range_args
        stz listrow
        lda #2                  ; ページ送りのキー待ちでは BREAK ですぐ止める
        sta bstate
        jsr fndlin_lo
sli_1:
        ldy #1
        lda (lowtr),Y
        beq sli_done            ; プログラムの終わり
        ldy #3                  ; 終わりを超えたか
        lda (lowtr),Y
        cmp bt3
        bcc sli_2
        bne sli_done
        dey
        lda (lowtr),Y
        cmp bt2
        beq sli_2
        bcs sli_done
sli_2:
        lda listrow             ; 画面がいっぱいならキーを待つ
        cmp #3
        bcc sli_3
        jsr BIOS_GETKEY
        cmp #K_RET
        beq sli_k
        cmp #K_DOWN
        beq sli_k
        cmp #' '
        bne sli_done
sli_k:
        stz listrow
sli_3:
        jsr crlf_if
        stz bt0                 ; 表示した文字数
        lda #0
        jsr detok_line
        lda bt0                 ; 使った行数 = (文字数 + 15) / 16
        clc
        adc #15
        lsr
        lsr
        lsr
        lsr
        clc
        adc listrow
        sta listrow
        jsr next_line
        bra sli_1
sli_done:
        lda #1
        sta bstate
        rts

; LIST、DELETE の範囲: bt0/bt1 = 初め(linnum にも)、bt2/bt3 = 終わり
range_args:
        stz linnum
        stz linnum+1
        lda #$FF
        sta bt2
        sta bt3
        jsr chrgot
        beq ra_done
        bcs ra_dash
        jsr linget
        lda linnum
        sta bt2
        lda linnum+1
        sta bt3
        jsr chrgot
        cmp #'-'
        bne ra_done
        lda #$FF                ; 初め- なら終わりまで
        sta bt2
        sta bt3
        bra ra_d2
ra_dash:
        cmp #'-'
        bne ra_sn
ra_d2:
        jsr chrget
        bcs ra_done
        lda linnum
        pha
        lda linnum+1
        pha
        jsr chrgot
        jsr linget
        lda linnum
        sta bt2
        lda linnum+1
        sta bt3
        pla
        sta linnum+1
        pla
        sta linnum
ra_done:
        lda linnum
        sta bt0
        lda linnum+1
        sta bt1
        rts
ra_sn:
        jmp err_sn

; lowtr = 行番号 linnum 以上の最初の行
fndlin_lo:
        jmp fndlin

; lowtr を次の行へ
next_line:
        ldy #0
        lda (lowtr),Y
        tax
        iny
        lda (lowtr),Y
        sta lowtr+1
        stx lowtr
        rts

; lowtr の行を文字にする。A=0 なら表示(bt0 に文字数)、A=1 なら LINEBUF へ(LINELEN)
detok_line:
        sta bt7
        lda #$80                ; まずキーワードの前後に空白を足す形で
        sta bt6
dl_again:
        tsx                     ; 入力行に入りきらなかったときに戻る位置
        stx bt5
        stz LINELEN
        ldy #2
        lda (lowtr),Y
        tax
        iny
        lda (lowtr),Y
        tay
        txa
        jsr fac_u16             ; 行番号
        jsr fout
        ldx #1
dl_1:
        lda fbuffr,X
        beq dl_2
        jsr dt_out
        inx
        bra dl_1
dl_2:
        lda #' '
        jsr dt_out
        clc                     ; 本文
        lda lowtr
        adc #4
        sta index2
        lda lowtr+1
        adc #0
        sta index2+1
dl_3:
        lda (index2)
        bne dl_3b
        rts                     ; 行の終わり
dl_3b:
        bmi dl_tok
        jsr dt_out
dl_next:
        inc index2
        bne dl_3
        inc index2+1
        bra dl_3
dl_tok:
        ; トークンをキーワードに。前が英字、数字、" か ) なら空白を足す
        pha
        bit bt6
        bpl dl_tk1
        lda bt4
        jsr dt_word
        bcc dl_tk1
        lda #' '
        jsr dt_out
dl_tk1:
        pla
        sec
        sbc #$80
        tax
        lda #<kwtab
        sta index1
        lda #>kwtab
        sta index1+1
dl_t1:
        cpx #0
        beq dl_t3
        ldy #0
dl_t2:
        lda (index1),Y
        iny
        asl
        bcc dl_t2
        tya
        clc
        adc index1
        sta index1
        bcc dl_t2b
        inc index1+1
dl_t2b:
        dex
        bra dl_t1
dl_t3:
        ldy #0
dl_t4:
        lda (index1),Y
        pha
        and #$7F
        jsr dt_out
        iny
        pla
        bpl dl_t4
        ; 後ろが英字、数字、"、.、& か次のキーワードなら空白を足す(SIN( などの後は足さない)
        bit bt6
        bpl dl_t5
        lda bt4
        cmp #'('
        beq dl_t5
        ldy #1
        lda (index2),Y
        bmi dl_t6               ; 次もキーワード
        cmp #'('                ; ( の前: 命令や AND などの後は空白、関数(SIN( など)の後は詰める
        bne dl_t7
        lda (index2)
        cmp #TK_SGN
        bcc dl_t6
        bra dl_t5
dl_t7:
        cmp #'.'
        beq dl_t6
        cmp #'&'
        beq dl_t6
        cmp #')'                ; ) は dt_word では英字の仲間だが、キーワードの後ろには空白を足さない(PI) など)
        beq dl_t5
        jsr dt_word
        bcc dl_t5
dl_t6:
        lda #' '
        jsr dt_out
dl_t5:
        jmp dl_next
dl_done:
        rts

; detok_line の1文字(X, Y は保存)
dt_out:
        sta bt4                 ; 最後に出した文字
        bit bt7
        bmi dto_buf             ; bt7 = $FF なら LINEBUF へ
        inc bt0
        jmp BIOS_CHROUT
dto_buf:
        phx
        ldx LINELEN
        cpx #LINEMAX
        bcs dto_full
        sta LINEBUF,X
        inc LINELEN
        plx
        rts
dto_full:
        plx
        bit bt6                 ; 空白を足した形で入りきらなければ、足さない形でやり直す
        bpl dto_ls
        stz bt6
        ldx bt5
        txs
        jmp dl_again
dto_ls:
        ldx #EN_LS
        jmp b_error

; A が英字、数字、" か ) なら C=1(キーワードとの間に空白を入れる文字)
dt_word:
        cmp #'"'
        beq dw_yes
        cmp #')'
        beq dw_yes
        cmp #'0'
        bcc dw_no
        cmp #'9'+1
        bcc dw_yes
        jmp isletter
dw_yes:
        sec
        rts
dw_no:
        clc
        rts

; EDIT 行番号: その行を入力行に出して直せるようにする
st_edit:
        bcc se_1
        jmp err_sn
se_1:
        jsr linget
        jsr fndlin
        bcs se_2
        jmp err_ul
se_2:
        lda #$FF
        jsr detok_line
        ldx #$FF
        txs
        stz contok
        stz bstate
        jsr crlf_if
        lda #'>'
        jsr BIOS_CHROUT
        jsr BIOS_GETLINE_ED
        jmp main_edit           ; 計算モードでも、直した行はプログラムに入れる

; DELETE 初め[-終わり]
st_delete:
        jsr range_args
        lda bt0
        ora bt1
        bne sdl_1
        jmp err_fc              ; 範囲がない
sdl_1:
        ; 消す範囲: [初めの行, 終わりの次の行)
        jsr fndlin
        lda lowtr
        sta dest
        lda lowtr+1
        sta dest+1
sdl_2:
        ldy #1
        lda (lowtr),Y
        beq sdl_3
        ldy #3
        lda (lowtr),Y
        cmp bt3
        bcc sdl_n
        bne sdl_3
        dey
        lda (lowtr),Y
        cmp bt2
        beq sdl_n
        bcs sdl_3
sdl_n:
        jsr next_line
        bra sdl_2
sdl_3:
        lda lowtr               ; [lowtr, vartab) を dest へ
        sta srcp
        lda lowtr+1
        sta srcp+1
        sec
        lda vartab
        sbc srcp
        sta movlen
        lda vartab+1
        sbc srcp+1
        sta movlen+1
        sec                     ; vartab -= 消した長さ
        lda srcp
        sbc dest
        sta bt0
        lda srcp+1
        sbc dest+1
        sta bt1
        lda dest
        pha
        lda dest+1
        pha
        jsr move_down
        pla
        sta dest+1
        pla
        sta dest
        sec
        lda vartab
        sbc bt0
        sta vartab
        lda vartab+1
        sbc bt1
        sta vartab+1
        jsr relink
        jsr clearc
        jmp ready

; ===================================================================
; RENUM [新しい開始[,増分[,元の開始]]]  行番号を振り直す
;   元の開始より後ろの行を、新しい開始から増分おきにする(省くと 10,10,0)。
;   GOTO GOSUB THEN ELSE RUN RESTORE と ON の並びの行番号も直す。
;   ない行への参照はそのまま残し、下調べのときに「UNDEF 番号 IN 行」で知らせる
;   (知らせが3行を超えてキーを待っているときは、BREAK で何も変えずにやめられる)。
;   順番が変わる、63999 を超えるときは何も変えずに FC。
;
; やり方: 振り直す行の元の番号の表をメモリの上端に作る(参照は二分探索で探す)。
; 下調べで伸びる分を数えて入るか確かめてから、プログラムを表のすぐ下へ移し、
; $0800 へ写し戻しながら行番号を書き換える。
; ===================================================================
st_renum:
        lda #10
        sta rn_new
        sta rn_inc
        stz rn_new+1
        stz rn_inc+1
        stz rn_old
        stz rn_old+1
        jsr rn_arg
        bcc rn_a1
        lda linnum
        sta rn_new
        lda linnum+1
        sta rn_new+1
rn_a1:
        jsr rn_comma
        beq rn_go
        jsr rn_arg
        bcc rn_a2
        lda linnum
        sta rn_inc
        lda linnum+1
        sta rn_inc+1
rn_a2:
        jsr rn_comma
        beq rn_go
        jsr rn_arg
        bcc rn_a3
        lda linnum
        sta rn_old
        lda linnum+1
        sta rn_old+1
rn_a3:
        jsr chrgot
        beq rn_go
        jmp err_sn
rn_go:
        lda rn_inc
        ora rn_inc+1
        bne rn_g1
        jmp err_fc
rn_g1:
        jsr rn_check            ; 順番と上限を確かめ、振り直す行を数える
        lda rn_cnt
        asl                     ; 表の始め = MEMSIZ - 行数 × 2
        sta bt0
        lda rn_cnt+1
        rol
        sta bt1
        sec
        lda #<MEMSIZ
        sbc bt0
        sta rn_tab
        lda #>MEMSIZ
        sbc bt1
        sta rn_tab+1
        stz rn_grow
        stz rn_grow+1
        jsr rn_room             ; 表が入るか
        jsr clearc              ; ここから変数の領域を使う
        jsr rn_mktab
        stz rn_mode             ; 下調べ: 伸びる分を数え、ない行への参照を知らせる
        stz rn_quiet
        stz listrow
        lda #2                  ; 知らせのキー待ちで BREAK を押したらすぐやめる(まだ何も変えていない)
        sta bstate
        lda #<PRGSTART
        sta srcp
        lda #>PRGSTART
        sta srcp+1
        jsr rn_scan
        lda #1                  ; ここからは BREAK で止めない
        sta bstate
        jsr rn_room             ; 伸びても入るか
        sec                     ; プログラムを表のすぐ下へ移す
        lda vartab
        sbc #<PRGSTART
        sta movlen
        lda vartab+1
        sbc #>PRGSTART
        sta movlen+1
        sec
        lda rn_tab
        sbc movlen
        sta dest
        sta bt2
        lda rn_tab+1
        sbc movlen+1
        sta dest+1
        sta bt3
        lda #<PRGSTART
        sta srcp
        lda #>PRGSTART
        sta srcp+1
        jsr move_up
        lda bt2                 ; そこから $0800 へ写し戻しながら書き換える
        sta srcp
        lda bt3
        sta srcp+1
        lda #<PRGSTART
        sta dest
        lda #>PRGSTART
        sta dest+1
        inc rn_mode
        jsr rn_scan
        lda dest                ; プログラムの終わり
        sta vartab
        lda dest+1
        sta vartab+1
        jsr relink
        jsr clearc
        jmp ready

; 数字があれば linnum に読んで C=1。なければ C=0
rn_arg:
        jsr chrgot
        bcs rn_arg0
        jsr linget
        sec
        rts
rn_arg0:
        clc
        rts

; 文の終わりなら Z=1。カンマなら読み飛ばして Z=0。ほかは SN
rn_comma:
        jsr chrgot
        beq rn_c1
        cmp #','
        beq rn_c2
        jmp err_sn
rn_c2:
        jsr chrget
        lda #1
rn_c1:
        rts

; vartab + rn_grow <= rn_tab でなければ OM
rn_room:
        clc
        lda vartab
        adc rn_grow
        sta bt0
        lda vartab+1
        adc rn_grow+1
        bcs rrm_om
        cmp rn_tab+1
        bcc rrm_ok
        bne rrm_om
        lda bt0
        cmp rn_tab
        bcc rrm_ok
        beq rrm_ok
rrm_om:
        jsr clearc
        jmp err_om
rrm_ok:
        rts

; 次に振り直す行の番号を rn_cur に。C=1 なら 16ビットを超えた
rn_step:
        lda rn_first
        beq rst_1
        stz rn_first
        lda rn_new
        sta rn_cur
        lda rn_new+1
        sta rn_cur+1
        clc
        rts
rst_1:
        clc
        lda rn_cur
        adc rn_inc
        sta rn_cur
        lda rn_cur+1
        adc rn_inc+1
        sta rn_cur+1
        rts

; 行番号 linnum が振り直す番号(>= rn_old)なら C=1
rn_isren:
        lda linnum+1
        cmp rn_old+1
        bne rir_1
        lda linnum
        cmp rn_old
rir_1:
        rts

; index2 の行の番号を linnum に
rn_getnum:
        ldy #2
        lda (index2),Y
        sta linnum
        iny
        lda (index2),Y
        sta linnum+1
        rts

; index2 を次の行へ(つなぎをたどる)
rn_nextl:
        ldy #0
        lda (index2),Y
        tax
        iny
        lda (index2),Y
        sta index2+1
        stx index2
        rts

; index2 をプログラムの始めに、rn_first を 1 に
rn_begin:
        lda #<PRGSTART
        sta index2
        lda #>PRGSTART
        sta index2+1
        lda #1
        sta rn_first
        rts

; 振り直しても順番が変わらないか、63999 を超えないかを確かめる。振り直す行の数を rn_cnt に
rn_check:
        jsr rn_begin
        stz rn_cnt
        stz rn_cnt+1
        stz bt4                 ; 1: 振り直さない行があった(その番号は bt2, bt3)
rck_1:
        ldy #1
        lda (index2),Y
        beq rck_done
        jsr rn_getnum
        jsr rn_isren
        bcs rck_ren
        lda linnum              ; 振り直さない行: 番号を覚える
        sta bt2
        lda linnum+1
        sta bt3
        lda #1
        sta bt4
        bra rck_next
rck_ren:
        lda rn_first
        beq rck_2
        lda bt4                 ; 最初の行: 前の行の番号 < 新しい開始
        beq rck_2
        lda bt3
        cmp rn_new+1
        bcc rck_2
        bne rck_fc
        lda bt2
        cmp rn_new
        bcs rck_fc
rck_2:
        jsr rn_step
        bcs rck_fc
        lda rn_cur+1            ; 64000 = $FA00 以上はだめ
        cmp #$FA
        bcs rck_fc
        inc rn_cnt
        bne rck_next
        inc rn_cnt+1
rck_next:
        jsr rn_nextl
        bra rck_1
rck_done:
        rts
rck_fc:
        jmp err_fc

; 振り直す行の元の番号の表を rn_tab から作る(小さい順)
rn_mktab:
        jsr rn_begin
        lda rn_tab
        sta index1
        lda rn_tab+1
        sta index1+1
rmt_1:
        ldy #1
        lda (index2),Y
        beq rmt_done
        jsr rn_getnum
        jsr rn_isren
        bcc rmt_2
        ldy #0
        lda linnum
        sta (index1),Y
        iny
        lda linnum+1
        sta (index1),Y
        clc
        lda index1
        adc #2
        sta index1
        bcc rmt_2
        inc index1+1
rmt_2:
        jsr rn_nextl
        bra rmt_1
rmt_done:
        rts

; 行番号 linnum を表から探す(二分探索)。あれば C=1、新しい番号は rn_val
rn_lookup:
        stz bt0                 ; lo = 0
        stz bt1
        lda rn_cnt              ; hi = 行数(hi は含まない)
        sta bt2
        lda rn_cnt+1
        sta bt3
rlk_1:
        lda bt1                 ; lo >= hi ならない
        cmp bt3
        bne rlk_1b
        lda bt0
        cmp bt2
rlk_1b:
        bcs rlk_no
        clc                     ; mid = (lo + hi) / 2
        lda bt0
        adc bt2
        sta bt6
        lda bt1
        adc bt3
        ror
        sta bt7
        ror bt6
        lda bt6                 ; index2 = rn_tab + mid × 2
        asl
        sta index2
        lda bt7
        rol
        sta index2+1
        clc
        lda index2
        adc rn_tab
        sta index2
        lda index2+1
        adc rn_tab+1
        sta index2+1
        ldy #1
        lda (index2),Y
        cmp linnum+1
        bne rlk_2
        dey
        lda (index2),Y
        cmp linnum
        beq rlk_found
rlk_2:
        bcs rlk_hi
        clc                     ; 表の値 < linnum: lo = mid + 1
        lda bt6
        adc #1
        sta bt0
        lda bt7
        adc #0
        sta bt1
        bra rlk_1
rlk_hi:
        lda bt6                 ; 表の値 > linnum: hi = mid
        sta bt2
        lda bt7
        sta bt3
        bra rlk_1
rlk_no:
        clc
        rts
rlk_found:
        lda rn_new              ; rn_val = rn_new + mid × rn_inc
        sta rn_val
        lda rn_new+1
        sta rn_val+1
        lda rn_inc
        sta bt0
        lda rn_inc+1
        sta bt1
rlk_m1:
        lda bt6
        ora bt7
        beq rlk_m3
        lsr bt7
        ror bt6
        bcc rlk_m2
        clc
        lda rn_val
        adc bt0
        sta rn_val
        lda rn_val+1
        adc bt1
        sta rn_val+1
rlk_m2:
        asl bt0
        rol bt1
        bra rlk_m1
rlk_m3:
        sec
        rts

; srcp から1バイト読んで進める(A に入れる)
rn_get:
        lda (srcp)
        inc srcp
        bne rgt_1
        inc srcp+1
rgt_1:
        rts

; 書き換えるとき(rn_mode = 1)だけ、A を dest に書いて進める(A は変えない)
rn_put:
        ldx rn_mode
        beq rpt_1
        sta (dest)
        inc dest
        bne rpt_1
        inc dest+1
rpt_1:
        rts

; 1バイト写す
rn_copy:
        jsr rn_get
        jmp rn_put

; " から、閉じる " まで(なければ行の終わりの 0 の前まで)写す
rn_copystr:
        jsr rn_copy
rcs_1:
        lda (srcp)
        beq rcs_2
        jsr rn_copy
        cmp #'"'
        bne rcs_1
rcs_2:
        rts

; プログラムを1行ずつ読み、行番号と、行番号の参照を書き換えながら写す。
; rn_mode = 0 なら何も書かずに伸びる分を rn_grow に数える
rn_scan:
        lda #1
        sta rn_first
rsc_line:
        jsr rn_copy             ; つなぎ(後で relink が直す)
        jsr rn_copy
        cmp #0
        bne rsc_l1
        rts                     ; 終わりの印(つなぎが0)
rsc_l1:
        jsr rn_get              ; 行番号
        sta linnum
        jsr rn_get
        sta linnum+1
        jsr rn_isren
        bcc rsc_l2
        jsr rn_step
        lda rn_cur
        sta linnum
        lda rn_cur+1
        sta linnum+1
rsc_l2:
        lda linnum              ; この行の新しい番号(警告に使う)
        sta rn_lnew
        lda linnum+1
        sta rn_lnew+1
        lda linnum
        jsr rn_put
        lda linnum+1
        jsr rn_put
rsc_ch:
        lda (srcp)
        beq rsc_eol
        bmi rsc_tok
        cmp #'"'
        beq rsc_str
        jsr rn_copy             ; ふつうの文字
        bra rsc_ch
rsc_tok:
        cmp #TK_REM
        beq rsc_rem
        cmp #TK_DATA
        beq rsc_data
        cmp #TK_GOTO
        beq rsc_ref
        cmp #TK_GOSUB
        beq rsc_ref
        cmp #TK_THEN
        beq rsc_ref
        cmp #TK_ELSE
        beq rsc_ref
        cmp #TK_RUN
        beq rsc_ref
        cmp #TK_RESTORE
        beq rsc_ref
        jsr rn_copy
        bra rsc_ch
rsc_eol:
        jsr rn_copy
        bra rsc_line
rsc_str:
        jsr rn_copystr
        bra rsc_ch
rsc_rem:
        jsr rn_copy             ; 行の終わりまで写す
        lda (srcp)
        bne rsc_rem
        bra rsc_eol
rsc_data:
        jsr rn_copy             ; : か行の終わりまで写す(" の中の : は除く)
rsd_1:
        lda (srcp)
        beq rsc_ch
        cmp #':'
        beq rsc_ch
        cmp #'"'
        bne rsc_data
        jsr rn_copystr
        bra rsd_1
rsc_ref:
        sta rn_ref
        jsr rn_copy
rsr_1:
        lda (srcp)              ; 空白を写す
        cmp #' '
        bne rsr_2
        jsr rn_copy
        bra rsr_1
rsr_2:
        cmp #'0'
        bcc rsc_ch
        cmp #'9'+1
        bcs rsc_ch
        lda dest                ; 数字の書き始め
        sta rn_dst0
        lda dest+1
        sta rn_dst0+1
        stz linnum              ; 数字を写しながら読む(65535 を超えたら bt5 = 1)
        stz linnum+1
        stz bt5
        stz rn_olen
rsr_3:
        lda (srcp)
        cmp #'0'
        bcc rsr_4
        cmp #'9'+1
        bcs rsr_4
        jsr rn_copy
        inc rn_olen
        and #$0F
        pha
        jsr rn_mul10
        pla
        clc
        adc linnum
        sta linnum
        bcc rsr_3
        inc linnum+1
        bne rsr_3
        lda #1
        sta bt5
        bra rsr_3
rsr_4:
        lda bt5
        bne rsr_undef           ; 65535 を超える番号
        jsr rn_lookup
        bcs rsr_found
        jsr rn_isren            ; 振り直す範囲になければない行
        bcs rsr_undef
        lda rn_mode             ; 前の行への参照: その行があるか(下調べのときだけ)
        bne rsr_5
        jsr fndlin
        bcs rsr_5
rsr_undef:
        lda rn_mode             ; ない行への参照は写したまま。下調べのときに知らせる
        bne rsr_5
        jsr rn_warn
        bra rsr_5
rsr_found:
        lda rn_mode
        bne rsr_put
        jsr rn_digits           ; 下調べ: 伸びる分を足す
        sec
        lda rn_nlen
        sbc rn_olen
        bcc rsr_5
        clc
        adc rn_grow
        sta rn_grow
        bcc rsr_5
        inc rn_grow+1
        bra rsr_5
rsr_put:
        jsr rn_fmt
        lda rn_dst0             ; 写した数字を新しい番号で書き直す
        sta dest
        lda rn_dst0+1
        sta dest+1
        ldy #0
rsr_p1:
        lda fbuffr,Y
        jsr rn_put
        iny
        cpy rn_nlen
        bne rsr_p1
rsr_5:
        lda (srcp)              ; 空白を写す
        cmp #' '
        bne rsr_6
        jsr rn_copy
        bra rsr_5
rsr_6:
        cmp #','                ; ON ... GOTO / GOSUB の並び
        bne rsr_7
        lda rn_ref
        cmp #TK_GOTO
        beq rsr_8
        cmp #TK_GOSUB
        bne rsr_7
rsr_8:
        jsr rn_copy
        jmp rsr_1
rsr_7:
        jmp rsc_ch

; 「UNDEF 参照の数字 IN 新しい行番号」を出す。3行ごとにキーを待つ
;   RET、↓、空白で続き、ほかのキーでそれからは出さない(振り直しは続ける)
rn_warn:
        lda rn_quiet
        bne rwn_done
        lda listrow
        cmp #3
        bcc rwn_2
        jsr BIOS_GETKEY
        cmp #K_RET
        beq rwn_1
        cmp #K_DOWN
        beq rwn_1
        cmp #' '
        beq rwn_1
        lda #1
        sta rn_quiet
rwn_done:
        rts
rwn_1:
        stz listrow
rwn_2:
        jsr crlf_if
        jsr strout_inline
        .byte "UNDEF ", 0
        sec                     ; 参照の数字(書いてあるとおり)
        lda srcp
        sbc rn_olen
        sta index1
        lda srcp+1
        sbc #0
        sta index1+1
        ldy #0
rwn_3:
        lda (index1),Y
        jsr BIOS_CHROUT
        iny
        cpy rn_olen
        bne rwn_3
        jsr strout_inline
        .byte " IN ", 0
        lda rn_lnew
        sta rn_val
        ldy rn_lnew+1
        sty rn_val+1
        jsr linprt
        jsr rn_digits           ; 使った行数 = (10 + 桁数 + 桁数 + 15) / 16
        clc
        lda #10+15
        adc rn_olen
        clc
        adc rn_nlen
        lsr
        lsr
        lsr
        lsr
        clc
        adc listrow
        sta listrow
        rts

; linnum を10倍する(Y は変えない)。16ビットを超えたら bt5 = 1
rn_mul10:
        lda linnum
        sta bt0
        lda linnum+1
        sta bt1
        asl linnum
        rol linnum+1
        bcs rml_ov
        asl linnum
        rol linnum+1
        bcs rml_ov
        clc
        lda linnum
        adc bt0
        sta linnum
        lda linnum+1
        adc bt1
        sta linnum+1
        bcs rml_ov
        asl linnum
        rol linnum+1
        bcc rml_1
rml_ov:
        lda #1
        sta bt5
rml_1:
        rts

; rn_val の10進の桁数を rn_nlen に
rn_digits:
        ldx #0
rdg_1:
        lda rn_val+1            ; rn_val < 10^(4-X) なら、桁数は 5-X より少ない
        cmp rn_pwhi,X
        bne rdg_2
        lda rn_val
        cmp rn_pwlo,X
rdg_2:
        bcs rdg_3
        inx
        cpx #4
        bne rdg_1
rdg_3:
        sec
        lda #5
        stx bt0
        sbc bt0
        sta rn_nlen
        rts

; rn_val を10進の文字にして fbuffr へ(先頭の0は出さない)。桁数は rn_nlen
rn_fmt:
        lda rn_val
        sta bt0
        lda rn_val+1
        sta bt1
        ldx #0                  ; 10000, 1000, 100, 10 の順
        ldy #0                  ; 書いた桁数
rfm_1:
        lda #'0'
        sta bt3
rfm_2:
        sec
        lda bt0
        sbc rn_pwlo,X
        pha
        lda bt1
        sbc rn_pwhi,X
        bcc rfm_3
        sta bt1
        pla
        sta bt0
        inc bt3
        bra rfm_2
rfm_3:
        pla
        lda bt3
        cpy #0                  ; まだ何も書いていなければ 0 は出さない
        bne rfm_4
        cmp #'0'
        beq rfm_5
rfm_4:
        sta fbuffr,Y
        iny
rfm_5:
        inx
        cpx #4
        bne rfm_1
        lda bt0                 ; 1の位
        ora #'0'
        sta fbuffr,Y
        iny
        sty rn_nlen
        rts
rn_pwlo:
        .byte <10000, <1000, <100, <10
rn_pwhi:
        .byte >10000, >1000, >100, >10
