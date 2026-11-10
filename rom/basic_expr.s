; PX-65 BASIC: 式、変数、配列、関数の呼び出し
;
; 式の値は FAC に置き、valtyp で型を表す(0 数、$FF 文字列)。
; 文字列の値は「記述子(長さ1バイト、番地2バイト)の番地」で、fac_m1(下位)fac_m2(上位)に置く。
; 記述子はいつも一時記述子の表(tempst)か変数の中にある。式の途中では一時記述子を使う
; (ガーベジコレクションで文字列が動いても、記述子が書き換わるので安全)。

; ===================================================================
; 式
; ===================================================================

; 式を読んで、数であることを確かめる
frmnum:
        jsr frmevl
chknum:
        lda valtyp
        bne ct_err
        rts
; 式を読んで、文字列であることを確かめる
frmstr:
        jsr frmevl
chkstr:
        lda valtyp
        beq ct_err
        rts
ct_err:
        jmp err_tm

; 式を読む。txtptr のいまの文字から始める
frmevl:
        tsx                     ; 式が深すぎないか
        cpx #$30
        bcs fe_1
        jmp err_om
fe_1:
        ; OR
        jsr ev_and
fe_or:
        jsr chrgot
        cmp #TK_OR
        bne fe_done
        jsr chknum
        jsr push_fac
        jsr chrget
        jsr ev_and
        jsr chknum
        jsr pop_arg
        jsr two_ints
        lda bt0
        ora linnum
        tax
        lda bt1
        ora linnum+1
        jsr int_result
        bra fe_or
fe_done:
        rts

; AND
ev_and:
        jsr ev_not
ea_loop:
        jsr chrgot
        cmp #TK_AND
        bne ea_done
        jsr chknum
        jsr push_fac
        jsr chrget
        jsr ev_not
        jsr chknum
        jsr pop_arg
        jsr two_ints
        lda bt0
        and linnum
        tax
        lda bt1
        and linnum+1
        jsr int_result
        bra ea_loop
ea_done:
        rts

; NOT
ev_not:
        jsr chrgot
        cmp #TK_NOT
        bne ev_rel
        jsr chrget
        jsr ev_not
        jsr chknum
        jsr getint16
        lda linnum
        eor #$FF
        tax
        lda linnum+1
        eor #$FF
        ; int_result へ

; X(下位)A(上位)の16ビット(符号付き)を FAC に
int_result:
        tay
        txa
        jmp fac_s16

; ARG と FAC を16ビット整数に。ARG → bt0/bt1、FAC → linnum
two_ints:
        jsr getint16
        lda linnum
        pha
        lda linnum+1
        pha
        jsr arg_to_fac
        jsr getint16
        lda linnum
        sta bt0
        lda linnum+1
        sta bt1
        pla
        sta linnum+1
        pla
        sta linnum
        rts

; 比較(= <> < > <= >=)
ev_rel:
        jsr ev_add
er_loop:
        jsr chrgot
        stz bt2                 ; 1 '>'、2 '='、4 '<'
er_op:
        cmp #'>'
        bne er_1
        lda #1
        bra er_set
er_1:
        cmp #'='
        bne er_2
        lda #2
        bra er_set
er_2:
        cmp #'<'
        bne er_3
        lda #4
er_set:
        tsb bt2
        jsr chrget
        bra er_op
er_3:
        lda bt2
        bne er_do
        rts
er_do:
        pha                     ; 比べ方
        jsr push_fac
        jsr ev_add
        jsr pop_arg
        lda valtyp
        cmp ptype
        beq *+5
        jmp ct_err
        lda valtyp
        bne er_str
        jsr fcmp                ; A = 1(ARG > FAC)、0、$FF
        bra er_res
er_str:
        jsr str_cmp
er_res:
        tax                     ; 結果を 1 '>'、2 '='、4 '<' に
        lda #2
        cpx #0
        beq er_r1
        lda #1
        cpx #1
        beq er_r1
        lda #4
er_r1:
        sta bt3
        pla
        and bt3
        beq er_false
        lda #$FF                ; 真 = -1
        tax
        bra er_r2
er_false:
        lda #0
        tax
er_r2:
        stz valtyp
        jsr int_result
        bra er_loop

; + -
ev_add:
        jsr ev_mul
ead_loop:
        jsr chrgot
        cmp #'+'
        beq ead_op
        cmp #'-'
        beq ead_op
        rts
ead_op:
        pha
        jsr push_fac
        jsr chrget
        jsr ev_mul
        jsr pop_arg
        pla
        ldx valtyp
        cpx ptype
        bne ead_tm
        cmp #'+'
        bne ead_sub
        cpx #0
        bne ead_cat
        jsr fadd
        bra ead_loop
ead_sub:
        cpx #0
        bne ead_tm
        jsr fsub
        bra ead_loop
ead_cat:
        jsr str_concat
        bra ead_loop
ead_tm:
        jmp err_tm

; * /
ev_mul:
        jsr ev_unary
em_loop:
        jsr chrgot
        cmp #'*'
        beq em_op
        cmp #'/'
        beq em_op
        rts
em_op:
        pha
        jsr chknum
        jsr push_fac
        jsr chrget
        jsr ev_unary
        jsr chknum
        jsr pop_arg
        pla
        cmp #'*'
        bne em_div
        jsr fmul
        bra em_loop
em_div:
        jsr fdiv
        bra em_loop

; 単項の - +
ev_unary:
        jsr chrgot
        cmp #'-'
        beq eu_neg
        cmp #'+'
        bne ev_pow
        jsr chrget
        bra ev_unary
eu_neg:
        jsr chrget
        jsr ev_unary
        jsr chknum
        jmp fac_neg

; ^
ev_pow:
        jsr ev_prim
ep_loop:
        jsr chrgot
        cmp #'^'
        beq ep_op
        rts
ep_op:
        jsr chknum
        jsr push_fac
        jsr chrget
        cmp #'-'                ; 2^-1 のような右側の符号
        bne ep_1
        jsr chrget
        jsr ev_prim
        jsr chknum
        jsr fac_neg
        bra ep_2
ep_1:
        cmp #'+'
        bne ep_3
        jsr chrget
ep_3:
        jsr ev_prim
        jsr chknum
ep_2:
        jsr pop_arg
        jsr fpow
        bra ep_loop

; 一番内側: 数、文字列、変数、関数、( )
ev_prim:
        jsr chrgot
        bcc epr_num             ; 数字
        cmp #'.'
        beq epr_num
        cmp #'&'
        beq epr_hex
        cmp #'"'
        bne *+5
        jmp epr_str
        cmp #'('
        beq epr_paren
        cmp #TK_SGN
        bcc epr_var
        cmp #TK_INSTR+1
        bcs epr_sn
        sec                     ; 関数
        sbc #TK_SGN
        asl
        tax
        jsr chrget
        jmp (func_table,X)
epr_var:
        jsr isletter
        bcc epr_sn
        jsr ptrget
        lda valtyp
        bne epr_svar
        lda varptr
        ldy varptr+1
        jmp fac_ld
epr_svar:
        lda varptr              ; 変数の記述子を一時記述子に写す
        sta strp
        lda varptr+1
        sta strp+1
        ldy #0
        lda (strp),Y
        pha
        iny
        lda (strp),Y
        tax
        iny
        lda (strp),Y
        tay
        pla
        jmp put_temp
epr_num:
        stz valtyp
        jmp fin
epr_paren:
        jsr chrget
        jsr frmevl
        jmp chkclose
epr_sn:
        jmp err_sn
epr_hex:
        jsr hex_lit
        bcs eh_err
        rts
eh_err:
        tax                     ; SN か OV
        jmp b_error

; &H のあとの16進数(0〜FFFF)を FAC に。chrgot が & を指していること(式、READ、INPUT で使う)
; 終わると chrgot は数の次の文字。C=1 なら A = EN_SN(書き方の間違い)か EN_OV(FFFF を超えた)
hex_lit:
        jsr chrget
        jsr toupper             ; DATA の中は小文字のままなので、小文字も受け付ける
        cmp #'H'
        bne hl_sn
        stz linnum
        stz linnum+1
        stz bt0                 ; 桁数
hl_1:
        jsr chrget
        jsr toupper
        jsr hexdig
        bcs hl_2
        tay
        lda linnum+1            ; もう1桁入るか
        and #$F0
        bne hl_ov
        ldx #4
hl_s:
        asl linnum
        rol linnum+1
        dex
        bne hl_s
        tya
        ora linnum
        sta linnum
        inc bt0
        bra hl_1
hl_2:
        lda bt0
        beq hl_sn
        stz valtyp
        lda linnum
        ldy linnum+1
        jsr fac_u16
        clc
        rts
hl_sn:
        lda #EN_SN
        sec
        rts
hl_ov:
        lda #EN_OV
        sec
        rts
epr_str:
        ; 文字列: " の次から、" か行の終わりまで
        clc
        lda txtptr
        adc #1
        sta strp
        lda txtptr+1
        adc #0
        sta strp+1
        ldy #0
es_1:
        lda (strp),Y
        beq es_2
        cmp #'"'
        beq es_2
        iny
        bne es_1
es_2:
        sty bt0                 ; 長さ
        tya                     ; txtptr を " の後へ
        clc
        adc strp
        sta txtptr
        lda strp+1
        adc #0
        sta txtptr+1
        lda (txtptr)
        beq es_3                ; 閉じていない
        jsr chrget
es_3:
        lda bt0
        ldx strp
        ldy strp+1
        jmp put_temp

; A が 0-9 か A-F なら C=0、A = 値
hexdig:
        cmp #'0'
        bcc hd_no
        cmp #'9'+1
        bcc hd_dig
        cmp #'A'
        bcc hd_no
        cmp #'F'+1
        bcs hd_no
        sbc #'A'-11
        clc
        rts
hd_dig:
        and #$0F
        clc
        rts
hd_no:
        sec
        rts

; A が英字なら C=1
isletter:
        cmp #'A'
        bcc il_no
        cmp #'Z'+1
        bcs il_no
        sec
        rts
il_no:
        clc
        rts

; ---- 式の途中の値をスタックに積む ----
; FAC(丸めて)と valtyp を積む。pop_arg で ARG に戻し、型は ptype に入る
push_fac:
        pla
        sta pf_ret
        pla
        sta pf_ret+1
        jsr fac_round
        lda fac_e
        pha
        lda fac_m1
        pha
        lda fac_m2
        pha
        lda fac_m3
        pha
        lda fac_m4
        pha
        lda fac_s
        pha
        lda valtyp
        pha
        lda pf_ret+1
        pha
        lda pf_ret
        pha
        rts

pop_arg:
        pla
        sta pf_ret
        pla
        sta pf_ret+1
        pla
        sta ptype
        pla
        sta arg_s
        pla
        sta arg_m4
        pla
        sta arg_m3
        pla
        sta arg_m2
        pla
        sta arg_m1
        pla
        sta arg_e
        stz arg_x
        lda pf_ret+1
        pha
        lda pf_ret
        pha
        rts

; ===================================================================
; 変数
; ===================================================================

; 変数(配列の要素も)を読む。txtptr のいまの文字は名前の1文字目。
; varptr = 値の番地、valtyp = 型。dimflg が1なら DIM(配列を作るだけ)
ptrget:
        jsr chrgot
        sta varnam
        stz varnam+1
        jsr chrget
pg_1:
        bcc pg_alnum            ; 数字
        jsr isletter
        bcc pg_end
pg_alnum:
        ldx varnam+1            ; 3文字目からは読み捨てる
        bne pg_skip
        sta varnam+1
pg_skip:
        jsr chrget
        bra pg_1
pg_end:
        stz valtyp
        cmp #'$'
        bne pg_2
        dec valtyp
        lda varnam+1
        ora #$80
        sta varnam+1
        jsr chrget
pg_2:
        cmp #'('
        bne pg_simple
        jmp pg_array
pg_simple:
        lda vartab
        sta index1
        lda vartab+1
        sta index1+1
ps_1:
        lda index1
        cmp arytab
        bne ps_2
        lda index1+1
        cmp arytab+1
        beq ps_new
ps_2:
        ldy #0
        lda (index1),Y
        cmp varnam
        bne ps_next
        iny
        lda (index1),Y
        cmp varnam+1
        beq ps_found
ps_next:
        clc
        lda index1
        adc #7
        sta index1
        bcc ps_1
        inc index1+1
        bra ps_1
ps_found:
        clc
        lda index1
        adc #2
        sta varptr
        lda index1+1
        adc #0
        sta varptr+1
        rts
ps_new:
        ; 新しい変数: 配列を7バイト上へずらして、その場所に作る
        lda #7
        ldy #0
        jsr reserve
        lda arytab
        sta srcp
        sta index1
        lda arytab+1
        sta srcp+1
        sta index1+1
        clc
        lda arytab
        adc #7
        sta dest
        lda arytab+1
        adc #0
        sta dest+1
        sec
        lda strend
        sbc arytab
        sta movlen
        lda strend+1
        sbc arytab+1
        sta movlen+1
        jsr move_up
        ; forpnt が配列の中を指していたら、一緒にずらす
        lda forpnt+1
        cmp arytab+1
        bcc pn_1
        bne pn_adj
        lda forpnt
        cmp arytab
        bcc pn_1
pn_adj:
        lda forpnt+1
        cmp strend+1
        bcc pn_add
        bne pn_1
        lda forpnt
        cmp strend
        bcs pn_1
pn_add:
        clc
        lda forpnt
        adc #7
        sta forpnt
        bcc pn_1
        inc forpnt+1
pn_1:
        clc
        lda arytab
        adc #7
        sta arytab
        bcc pn_2
        inc arytab+1
pn_2:
        clc
        lda strend
        adc #7
        sta strend
        bcc pn_3
        inc strend+1
pn_3:
        ldy #0
        lda varnam
        sta (index1),Y
        iny
        lda varnam+1
        sta (index1),Y
        lda #0
pn_4:
        iny
        sta (index1),Y
        cpy #6
        bne pn_4
        jmp ps_found

; strend から A(下位)Y(上位)バイトが使えるようにする。足りなければ文字列を詰める。
; それでも足りなければ OM エラー
reserve:
        sta bt6
        sty bt7
        jsr rs_check
        bcc rs_ok
        jsr garbag
        jsr rs_check
        bcc rs_ok
        jmp err_om
rs_ok:
        rts
; strend + 長さ < fretop なら C=0
rs_check:
        clc
        lda strend
        adc bt6
        tax
        lda strend+1
        adc bt7
        bcs rsc_no
        cmp fretop+1
        bcc rsc_yes
        bne rsc_no
        cpx fretop
        bcc rsc_yes
rsc_no:
        sec
        rts
rsc_yes:
        clc
        rts

; ---- 配列 ----
; 名前の後の ( から。添字を読んで、要素の番地を varptr に
pg_array:
        stz subcnt
pa_loop:
        lda subcnt              ; 添字の式の中でも変数を読むので、いまの状態を積む
        pha
        lda varnam
        pha
        lda varnam+1
        pha
        lda valtyp
        pha
        lda dimflg
        pha
        stz dimflg
        jsr chrget              ; ( か , の次
        jsr frmnum
        jsr getint16
        pla
        sta dimflg
        pla
        sta valtyp
        pla
        sta varnam+1
        pla
        sta varnam
        pla
        sta subcnt
        lda linnum+1            ; 添字は 0-32767
        bmi pa_fc
        pha
        lda linnum
        pha
        inc subcnt
        lda subcnt
        cmp #MAXDIM+1
        bcc pa_d
        jmp pa_bs
pa_d:
        jsr chrgot
        cmp #','
        beq pa_loop
        cmp #')'
        bne pa_sn
        jsr chrget
        ; 配列を探す
        lda arytab
        sta index1
        lda arytab+1
        sta index1+1
pa_find:
        lda index1
        cmp strend
        bne pa_f1
        lda index1+1
        cmp strend+1
        beq pa_new
pa_f1:
        ldy #0
        lda (index1),Y
        cmp varnam
        bne pa_fnext
        iny
        lda (index1),Y
        cmp varnam+1
        beq pa_found
pa_fnext:
        ldy #2                  ; 次の配列 = index1 + 大きさ
        clc
        lda (index1),Y
        adc index1
        tax
        iny
        lda (index1),Y
        adc index1+1
        sta index1+1
        stx index1
        bra pa_find
pa_fc:
        jmp err_fc
pa_sn:
        jmp err_sn
pa_found:
        lda dimflg
        beq pa_f2
        ldx #EN_DD             ; 2回目の DIM
        jmp b_error
pa_f2:
        ldy #4
        lda (index1),Y
        cmp subcnt
        bne *+5
        jmp pa_elem
pa_bs:
        ldx #EN_BS
        jmp b_error

pa_new:
        ; 配列を作る。大きさ = 見出し(5 + 2×次元数)+ 要素の大きさ × 要素数
        lda #1
        sta bt2                 ; 要素数(16ビット)
        stz bt3
        ldx subcnt
        ; 添字はスタックに積んである(最後の添字が一番上)。各次元の大きさを見出しに書くため
        ; いったん dimbuf に移す
        tsx
        stx bt4                 ; スタック上の添字の位置
        ldy subcnt
        dey                     ; Y = 次元の番号(最後から)
pn_dim:
        lda dimflg
        bne pn_d1
        lda #11                 ; DIM していない: 各次元 0-10
        sta dimbuf_lo,Y
        lda #0
        sta dimbuf_hi,Y
        bra pn_d2
pn_d1:
        inx                     ; DIM: 添字 + 1
        lda $0100,X
        clc
        adc #1
        sta dimbuf_lo,Y
        inx
        lda $0100,X
        adc #0
        sta dimbuf_hi,Y
pn_d2:
        ; 要素数 × この次元の大きさ
        phx
        phy
        lda dimbuf_lo,Y
        sta bt0
        lda dimbuf_hi,Y
        sta bt1
        jsr mul16               ; bt2/bt3 = bt2/bt3 × bt0/bt1
        bcc *+5
        jmp pn_om
        ply
        plx
        dey
        bpl pn_dim
        ; DIM していないときは、スタックの添字はまだ使う(要素の番地を出す)
        ; 大きさ = 要素数 × (5 か 3)+ 見出し
        lda bt2
        sta bt0
        lda bt3
        sta bt1
        lda #5
        ldx valtyp
        beq pn_5
        lda #3
pn_5:
        sta bt4
        jsr mul_small           ; bt0/bt1 × bt4 → bt0/bt1
        bcs pn_om
        lda subcnt              ; + 5 + 2 × 次元数
        asl
        adc #5
        clc
        adc bt0
        sta bt0
        bcc pn_6
        inc bt1
        beq pn_om
pn_6:
        lda bt0
        ldy bt1
        jsr reserve
        ; 作る場所 = strend
        lda strend
        sta index1
        lda strend+1
        sta index1+1
        clc
        lda strend
        adc bt0
        sta strend
        lda strend+1
        adc bt1
        sta strend+1
        ; 0 で埋める
        lda bt0
        sta movlen
        lda bt1
        sta movlen+1
        jsr zero_fill
        ; 見出し
        ldy #0
        lda varnam
        sta (index1),Y
        iny
        lda varnam+1
        sta (index1),Y
        iny
        lda bt0
        sta (index1),Y
        iny
        lda bt1
        sta (index1),Y
        iny
        lda subcnt
        sta (index1),Y
        ldx #0
pn_7:
        iny
        lda dimbuf_lo,X
        sta (index1),Y
        iny
        lda dimbuf_hi,X
        sta (index1),Y
        inx
        cpx subcnt
        bne pn_7
        lda dimflg
        beq pa_elem
        ; DIM: 添字をスタックから捨てて終わり
        ldx subcnt
pn_drop:
        pla
        pla
        dex
        bne pn_drop
        rts
pn_om:
        jmp err_om

; 要素の番地を出す。index1 = 配列の見出し。スタックに添字(最後の添字が一番上)
pa_elem:
        stz bt2                 ; 要素の番号(16ビット)
        stz bt3
        ldx subcnt
        dex                     ; 最後の次元から
pe_1:
        ; 番号 = 番号 × この次元の大きさ + 添字
        txa
        asl
        clc
        adc #5
        tay                     ; 見出しの中の次元の大きさの位置
        lda (index1),Y
        sta bt0
        iny
        lda (index1),Y
        sta bt1
        phx
        jsr mul16
        plx
        pla                     ; 添字(下位)
        sta bt4
        pla                     ; 添字(上位)
        sta bt5
        ; 添字 < 大きさ か
        cmp bt1
        bcc pe_ok
        bne pe_bs
        lda bt4
        cmp bt0
        bcs pe_bs
pe_ok:
        clc
        lda bt2
        adc bt4
        sta bt2
        lda bt3
        adc bt5
        sta bt3
        dex
        bpl pe_1
        ; 番地 = 見出し + 5 + 2 × 次元数 + 番号 × (5 か 3)
        lda bt2
        sta bt0
        lda bt3
        sta bt1
        lda #5
        ldx valtyp
        beq pe_2
        lda #3
pe_2:
        sta bt4
        jsr mul_small
        ldy #4
        lda (index1),Y
        asl
        adc #5
        clc
        adc bt0
        sta bt0
        bcc pe_3
        inc bt1
pe_3:
        clc
        lda index1
        adc bt0
        sta varptr
        lda index1+1
        adc bt1
        sta varptr+1
        rts
pe_bs:
        ; スタックの残りの添字は、エラー処理でスタックごと捨てる
        ldx #EN_BS
        jmp b_error

; bt2/bt3 = bt2/bt3 × bt0/bt1(符号なし16ビット)。あふれたら C=1
mul16:
        stz bt4
        stz bt5
        ldx #16
m16_1:
        asl bt4
        rol bt5
        bcs m16_ov
        asl bt2
        rol bt3
        bcc m16_2
        clc
        lda bt4
        adc bt0
        sta bt4
        lda bt5
        adc bt1
        sta bt5
        bcs m16_ov
m16_2:
        dex
        bne m16_1
        lda bt4
        sta bt2
        lda bt5
        sta bt3
        clc
        rts
m16_ov:
        sec
        rts

; bt0/bt1 = bt0/bt1 × bt4(3 か 5)。あふれたら C=1
mul_small:
        lda bt0
        sta bt2
        lda bt1
        sta bt3
        asl bt0                 ; ×2
        rol bt1
        bcs ms_ov
        lda bt4
        cmp #3
        beq ms_add
        asl bt0                 ; ×4
        rol bt1
        bcs ms_ov
ms_add:
        clc
        lda bt0
        adc bt2
        sta bt0
        lda bt1
        adc bt3
        sta bt1
        rts
ms_ov:
        sec
        rts

; index1 から movlen バイトを 0 にする
zero_fill:
        lda index1
        sta dest
        lda index1+1
        sta dest+1
        lda #0
        ldx movlen+1
        beq zf_2
        ldy #0
zf_1:
        sta (dest),Y
        iny
        bne zf_1
        inc dest+1
        dex
        bne zf_1
zf_2:
        ldy movlen
        beq zf_4
zf_3:
        dey
        sta (dest),Y
        cpy #0
        bne zf_3
zf_4:
        rts

; ===================================================================
; 関数の表(TK_SGN から)
; ===================================================================
func_table:
        .word fn_sgn, fn_int, fn_abs, fn_fre, fn_sqr, fn_rnd, fn_ln, fn_log, fn_exp
        .word fn_cos, fn_sin, fn_tan, fn_atn, fn_peek, fn_len, fn_strs, fn_val, fn_asc
        .word fn_chrs, fn_hexs, fn_point, fn_pi, fn_inkeys, fn_lefts, fn_rights, fn_mids, fn_instr

; ( 式 ) を数として読む
par_num:
        jsr chkopen
        jsr frmnum
        jmp chkclose

fn_sgn:
        jsr par_num
        lda fac_e
        beq fs_done
        lda #<c_one
        ldy #>c_one
        ldx fac_s
        bpl fs_1
        lda #<c_mone
        ldy #>c_mone
fs_1:
        jmp fac_ld
fs_done:
        rts

fn_int:
        jsr par_num
        jmp fac_int

fn_abs:
        jsr par_num
        stz fac_s
        rts

fn_fre:
        jsr par_num
        jsr garbag
        jsr fre_bytes
        stz valtyp
        jmp fac_u16

fn_peek:
        jsr par_num
        jsr getint16
        lda (linnum)
        jmp fac_u8

fn_pi:
        stz valtyp
        lda #<c_pi
        ldy #>c_pi
        jmp fac_ld
