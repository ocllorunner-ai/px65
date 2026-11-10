; PX-65 BASIC: 浮動小数点の四則演算、比較、変換
;
; FAC と ARG は basic.s を参照。メモリ上の数は5バイト(tools/mkfpconst.js を参照)。
; 2つの数をとる演算は ARG(左)と FAC(右)を使い、結果を FAC に置く。

; ===================================================================
; 読み書きとコピー
; ===================================================================

; FAC = (A=下位, Y=上位) の番地の数
fac_ld:
        sta fptr
        sty fptr+1
        ldy #4
        lda (fptr),Y
        sta fac_m4
        dey
        lda (fptr),Y
        sta fac_m3
        dey
        lda (fptr),Y
        sta fac_m2
        dey
        lda (fptr),Y
        tax
        ora #$80
        sta fac_m1
        txa
        and #$80
        sta fac_s
        dey
        lda (fptr),Y
        sta fac_e
        stz fac_x
        rts

; ARG = (A, Y) の番地の数
arg_ld:
        sta fptr
        sty fptr+1
        ldy #4
        lda (fptr),Y
        sta arg_m4
        dey
        lda (fptr),Y
        sta arg_m3
        dey
        lda (fptr),Y
        sta arg_m2
        dey
        lda (fptr),Y
        tax
        ora #$80
        sta arg_m1
        txa
        and #$80
        sta arg_s
        dey
        lda (fptr),Y
        sta arg_e
        stz arg_x
        rts

; (A, Y) の番地に FAC を書く(丸めてから)
fac_st:
        sta fptr
        sty fptr+1
        jsr fac_round
        ldy #0
        lda fac_e
        sta (fptr),Y
        beq fst_zero
        iny
        lda fac_m1
        and #$7F
        ora fac_s
        sta (fptr),Y
        iny
        lda fac_m2
        sta (fptr),Y
        iny
        lda fac_m3
        sta (fptr),Y
        iny
        lda fac_m4
        sta (fptr),Y
        rts
fst_zero:
        lda #0
        iny
        sta (fptr),Y
        iny
        sta (fptr),Y
        iny
        sta (fptr),Y
        iny
        sta (fptr),Y
        rts

; ARG = FAC(丸めてから)
fac_to_arg:
        jsr fac_round
        ldx #5
fta_1:
        lda fac_e,X
        sta arg_e,X
        dex
        bpl fta_1
        stz arg_x
        rts

; FAC = ARG
arg_to_fac:
        ldx #5
atf_1:
        lda arg_e,X
        sta fac_e,X
        dex
        bpl atf_1
        stz fac_x
        rts

; FAC と ARG を入れ替える(丸め用のバイトも)
swap_fa:
        ldx #6
sfa_1:
        lda fac_e,X
        ldy arg_e,X
        sta arg_e,X
        sty fac_e,X
        dex
        bpl sfa_1
        rts

; FAC = 0
fac_zero:
        stz fac_e
        stz fac_s
        stz fac_x
        rts

; FAC = -FAC
fac_neg:
        lda fac_e
        beq fng_1
        lda fac_s
        eor #$80
        sta fac_s
fng_1:
        rts

; ===================================================================
; 丸めと正規化
; ===================================================================

; 丸め用のバイトを仮数に丸め込む
fac_round:
        lda fac_x
        bpl frd_done
        lda fac_e
        beq frd_done
        inc fac_m4
        bne frd_done
        inc fac_m3
        bne frd_done
        inc fac_m2
        bne frd_done
        inc fac_m1
        bne frd_done
        lda #$80                ; 仮数があふれた
        sta fac_m1
        inc fac_e
        bne frd_done
        jmp err_ov
frd_done:
        stz fac_x
        rts

; 仮数の最上位ビットが1になるように左へずらす(指数を減らす)
fac_norm:
        lda fac_e
        beq fac_zero
fnm_byte:
        lda fac_m1
        bne fnm_bit
        lda fac_m2              ; 1バイトずつずらす
        ora fac_m3
        ora fac_m4
        ora fac_x
        beq fac_zero
        lda fac_m2
        sta fac_m1
        lda fac_m3
        sta fac_m2
        lda fac_m4
        sta fac_m3
        lda fac_x
        sta fac_m4
        stz fac_x
        lda fac_e
        sec
        sbc #8
        bcc fac_zero
        beq fac_zero
        sta fac_e
        bra fnm_byte
fnm_bit:
        bmi fnm_done
fnm_1:
        asl fac_x
        rol fac_m4
        rol fac_m3
        rol fac_m2
        rol fac_m1
        dec fac_e
        beq fac_zero
        lda fac_m1
        bpl fnm_1
fnm_done:
        rts

; ft8/ft9(符号付き16ビット)を指数にする。1未満なら0、255を超えたらオーバーフロー
set_exp16:
        lda ft9
        bpl *+5
        jmp fac_zero
        bne se_ov
        lda ft8
        bne *+5
        jmp fac_zero
        sta fac_e
        rts
se_ov:
        jmp err_ov

; ===================================================================
; 加減算
; ===================================================================

; FAC = ARG - FAC
fsub:
        jsr fac_neg
        ; そのまま fadd へ

; FAC = ARG + FAC
fadd:
        lda arg_e
        bne fad_1
        rts                     ; ARG が0
fad_1:
        lda fac_e
        bne fad_2
        jmp arg_to_fac          ; FAC が0
fad_2:
        cmp arg_e               ; 指数の大きい方を FAC に
        bcs fad_3
        jsr swap_fa
fad_3:
        sec
        lda fac_e
        sbc arg_e
        cmp #41
        bcc fad_4
        rts                     ; ARG は小さすぎて影響しない
fad_4:
        tax
        jsr arg_shr
        lda fac_s
        eor arg_s
        bmi fad_sub
        clc                     ; 同じ符号: 仮数を足す
        lda fac_x
        adc arg_x
        sta fac_x
        lda fac_m4
        adc arg_m4
        sta fac_m4
        lda fac_m3
        adc arg_m3
        sta fac_m3
        lda fac_m2
        adc arg_m2
        sta fac_m2
        lda fac_m1
        adc arg_m1
        sta fac_m1
        bcc fad_done
        ror fac_m1              ; 繰り上がり: 右へ1ビット
        ror fac_m2
        ror fac_m3
        ror fac_m4
        ror fac_x
        inc fac_e
        bne fad_done
        jmp err_ov
fad_done:
        rts
fad_sub:
        sec                     ; 違う符号: 仮数を引く
        lda fac_x
        sbc arg_x
        sta fac_x
        lda fac_m4
        sbc arg_m4
        sta fac_m4
        lda fac_m3
        sbc arg_m3
        sta fac_m3
        lda fac_m2
        sbc arg_m2
        sta fac_m2
        lda fac_m1
        sbc arg_m1
        sta fac_m1
        bcs fad_norm
        lda fac_s               ; 引きすぎた: 符号を反対にして仮数を2の補数に
        eor #$80
        sta fac_s
        sec
        lda #0
        sbc fac_x
        sta fac_x
        lda #0
        sbc fac_m4
        sta fac_m4
        lda #0
        sbc fac_m3
        sta fac_m3
        lda #0
        sbc fac_m2
        sta fac_m2
        lda #0
        sbc fac_m1
        sta fac_m1
fad_norm:
        jmp fac_norm

; ARG の仮数を X ビット右へずらす(丸め用のバイトまで)
arg_shr:
ash_1:
        cpx #8
        bcc ash_2
        lda arg_m4
        sta arg_x
        lda arg_m3
        sta arg_m4
        lda arg_m2
        sta arg_m3
        lda arg_m1
        sta arg_m2
        stz arg_m1
        txa
        sbc #8                  ; C=1
        tax
        bra ash_1
ash_2:
        cpx #0
        beq ash_done
ash_3:
        lsr arg_m1
        ror arg_m2
        ror arg_m3
        ror arg_m4
        ror arg_x
        dex
        bne ash_3
ash_done:
        rts

; ===================================================================
; 乗除算
; ===================================================================

; FAC = ARG × FAC
fmul:
        lda fac_e
        bne *+5             ; 0 × x = 0
        jmp fml_ret
        lda arg_e
        bne fml_1
        jmp fac_zero
fml_1:
        clc                     ; 指数 = ARG + FAC - 128(16ビット)
        adc fac_e
        sta ft8
        lda #0
        adc #0
        sta ft9
        sec
        lda ft8
        sbc #128
        sta ft8
        lda ft9
        sbc #0
        sta ft9
        lda fac_s
        eor arg_s
        sta fac_s
        lda fac_m1              ; 乗数を ft0-ft3 に移し、FAC の仮数を積にする
        sta ft0
        lda fac_m2
        sta ft1
        lda fac_m3
        sta ft2
        lda fac_m4
        sta ft3
        stz fac_m1
        stz fac_m2
        stz fac_m3
        stz fac_m4
        stz fac_x
        stz ft4
        ldx #3                  ; 乗数の下のバイトから
fml_byte:
        lda ft0,X
        bne fml_bits
        lda fac_x               ; 0 のバイト: 積を8ビット右へずらすだけ
        sta ft4
        lda fac_m4
        sta fac_x
        lda fac_m3
        sta fac_m4
        lda fac_m2
        sta fac_m3
        lda fac_m1
        sta fac_m2
        stz fac_m1
        bra fml_next
fml_bits:
        sta ft5
        ldy #8
fml_loop:
        lsr ft5
        bcc fml_shift
        clc
        lda fac_m4
        adc arg_m4
        sta fac_m4
        lda fac_m3
        adc arg_m3
        sta fac_m3
        lda fac_m2
        adc arg_m2
        sta fac_m2
        lda fac_m1
        adc arg_m1
        sta fac_m1
fml_shift:
        ror fac_m1
        ror fac_m2
        ror fac_m3
        ror fac_m4
        ror fac_x
        ror ft4
        dey
        bne fml_loop
fml_next:
        dex
        bpl fml_byte
        lda fac_m1              ; 積は 0.25 以上なので、ずらすのは多くても1ビット
        bmi fml_exp
        asl ft4
        rol fac_x
        rol fac_m4
        rol fac_m3
        rol fac_m2
        rol fac_m1
        jsr dec_exp16
fml_exp:
        jmp set_exp16
fml_ret:
        rts

; ft8/ft9 を1減らす
dec_exp16:
        lda ft8
        bne dex_1
        dec ft9
dex_1:
        dec ft8
        rts

; FAC = ARG / FAC
fdiv:
        lda fac_e
        bne fdv_1
        jmp err_div0
fdv_1:
        lda arg_e
        bne fdv_2
        jmp fac_zero
fdv_2:
        sec                     ; 指数 = ARG - FAC + 129(16ビット)
        sbc fac_e
        sta ft8
        lda #0
        sbc #0
        sta ft9
        clc
        lda ft8
        adc #129
        sta ft8
        lda ft9
        adc #0
        sta ft9
        lda fac_s
        eor arg_s
        sta fac_s
        lda fac_m1              ; 除数を ft0-ft3 に。余りは ft4 + ARG の仮数
        sta ft0
        lda fac_m2
        sta ft1
        lda fac_m3
        sta ft2
        lda fac_m4
        sta ft3
        stz ft4
        ldx #40                 ; 商を40ビット作る
fdv_loop:
        sec                     ; 余り - 除数
        lda arg_m4
        sbc ft3
        sta ft5
        lda arg_m3
        sbc ft2
        sta ft6
        lda arg_m2
        sbc ft1
        sta ft7
        lda arg_m1
        sbc ft0
        tay
        lda ft4
        sbc #0
        bcc fdv_bit             ; 引けない: 商のビットは0(C=0)
        sta ft4                 ; 引ける: 余りを更新、商のビットは1(C=1)
        sty arg_m1
        lda ft7
        sta arg_m2
        lda ft6
        sta arg_m3
        lda ft5
        sta arg_m4
fdv_bit:
        rol fac_x
        rol fac_m4
        rol fac_m3
        rol fac_m2
        rol fac_m1
        asl arg_x               ; 余りを左へ(ARG の丸め用のバイトも割られる数に含める)
        rol arg_m4
        rol arg_m3
        rol arg_m2
        rol arg_m1
        rol ft4
        dex
        bne fdv_loop
        lda fac_m1              ; 商は 0.5 より大きいので、ずらすのは多くても1ビット
        bmi fdv_exp
        asl fac_x
        rol fac_m4
        rol fac_m3
        rol fac_m2
        rol fac_m1
        jsr dec_exp16
fdv_exp:
        jmp set_exp16

; ARG = FAC(丸め用のバイトも写す。丸めない)
fac_to_arg_x:
        ldx #6
ftx_1:
        lda fac_e,X
        sta arg_e,X
        dex
        bpl ftx_1
        rts

; FAC = FAC × 10(仮数をずらして足すので速い。丸め用のバイトも使う)
mul10:
        lda fac_e
        beq m10_done
        jsr fac_to_arg_x        ; ARG = FAC × 2、FAC = FAC × 8
        inc arg_e
        beq m10_ov
        lda fac_e
        clc
        adc #3
        bcs m10_ov
        sta fac_e
        jmp fadd
m10_ov:
        jmp err_ov
m10_done:
        rts

; FAC = FAC / 10
div10:
        jsr fac_to_arg_x
        lda #<c_ten
        ldy #>c_ten
        jsr fac_ld
        jmp fdiv

; ===================================================================
; 比較
; ===================================================================

; ARG と FAC を比べる。A = 0(等しい)、1(ARG が大きい)、$FF(ARG が小さい)
fcmp:
        jsr fac_round
; 丸めずに比べる(FAC の丸め用のバイトは無視する)
fcmp_nr:
        lda arg_e
        bne fcp_1
        lda fac_e
        beq fcp_eq
fcp_fsign:
        lda fac_s               ; FAC が負なら ARG が大きい
        bmi fcp_gt
        bra fcp_lt
fcp_1:
        lda fac_e
        bne fcp_2
        lda arg_s               ; FAC が0: ARG の符号で決まる
        bmi fcp_lt
        bra fcp_gt
fcp_2:
        lda arg_s
        eor fac_s
        bmi fcp_fsign           ; 符号が違う
        ldx #0                  ; 同じ符号: 指数、仮数の順に比べる
fcp_3:
        lda arg_e,X
        cmp fac_e,X
        bne fcp_4
        inx
        cpx #5
        bne fcp_3
fcp_eq:
        lda #0
        rts
fcp_4:
        lda #1                  ; C=1 なら |ARG| > |FAC|
        bcs fcp_5
        lda #$FF
fcp_5:
        bit arg_s
        bpl fcp_6
        eor #$FE                ; 負なら逆
fcp_6:
        cmp #0
        rts
fcp_gt:
        lda #1
        rts
fcp_lt:
        lda #$FF
        rts

; ===================================================================
; 整数との変換
; ===================================================================

; FAC = A(下位)Y(上位)の符号なし16ビット整数
fac_u16:
        sty fac_m1
        sta fac_m2
        stz fac_m3
        stz fac_m4
        stz fac_x
        stz fac_s
        lda #128+16
        sta fac_e
        jmp fac_norm

; FAC = A の 0-255
fac_u8:
        ldy #0
        bra fac_u16

; FAC = A(下位)Y(上位)の符号付き16ビット整数
fac_s16:
        cpy #$80
        bcc fac_u16
        eor #$FF                ; 絶対値にする
        clc
        adc #1
        tax
        tya
        eor #$FF
        adc #0
        tay
        txa
        jsr fac_u16
        lda #$80
        sta fac_s
        rts

; FAC の小数部を切り捨てる(0 に向けて)。A = 切り捨てたビットがあれば0以外
; (FAC は丸め済みで、指数が 129 から 159 のとき)
fac_chop:
        sec
        lda fac_e
        sbc #128
        sta ft0                 ; 整数部のビット数
        stz ft1                 ; 切り捨てたビット
        ldx #0
fch_1:
        lda ft0
        cmp #8
        bcs fch_full
        tay
        lda chop_mask,Y
        eor #$FF
        and fac_m1,X
        ora ft1
        sta ft1
        lda chop_mask,Y
        and fac_m1,X
        sta fac_m1,X
        stz ft0
        bra fch_next
fch_full:
        sbc #8
        sta ft0
fch_next:
        inx
        cpx #4
        bne fch_1
        lda ft1
        rts
chop_mask:
        .byte $00, $80, $C0, $E0, $F0, $F8, $FC, $FE

; FAC = FAC 以下の最大の整数(INT)
fac_int:
        jsr fac_round
        lda fac_e
        cmp #128+32
        bcs fint_done           ; すでに整数
        cmp #129
        bcs fint_chop
        lda fac_e               ; |x| < 1
        beq fint_done
        lda fac_s
        bmi fint_m1
        jmp fac_zero
fint_m1:
        lda #<c_mone
        ldy #>c_mone
        jmp fac_ld
fint_chop:
        jsr fac_chop
        beq fint_done
        lda fac_s
        bpl fint_done
        lda #<c_mone            ; 負で小数があった: さらに1を引く
        ldy #>c_mone
        jsr arg_ld
        jmp fadd
fint_done:
        rts

; FAC を整数に(0 に向けて切り捨て)して linnum に置く。-32768 から 65535 まで。
; 範囲外なら FC エラー
getint16:
        jsr fac_round
        stz linnum
        stz linnum+1
        lda fac_e
        cmp #129
        bcc gi_done             ; |x| < 1 なら 0
        cmp #128+17
        bcs gi_fc               ; 65536 以上
        lda fac_m1
        sta linnum+1
        lda fac_m2
        sta linnum
        sec
        lda #128+16
        sbc fac_e
        tax
        beq gi_sign
gi_1:
        lsr linnum+1
        ror linnum
        dex
        bne gi_1
gi_sign:
        lda fac_s
        bpl gi_done
        lda linnum+1            ; 負: 32768 まで
        cmp #$80
        bcc gi_neg
        bne gi_fc
        lda linnum
        bne gi_fc
gi_neg:
        sec
        lda #0
        sbc linnum
        sta linnum
        lda #0
        sbc linnum+1
        sta linnum+1
gi_done:
        rts
gi_fc:
        jmp err_fc

; FAC を 0-255 の整数にして A と X に。範囲外なら FC エラー
getbyte:
        jsr getint16
        lda linnum+1
        bne gi_fc
        lda linnum
        tax
        rts

; FAC(0 以上、2^32 未満)を32ビット整数にして ft0-ft3(上位から)に置く。切り捨て
fac_u32:
        lda fac_m1
        sta ft0
        lda fac_m2
        sta ft1
        lda fac_m3
        sta ft2
        lda fac_m4
        sta ft3
        sec
        lda #128+32
        sbc fac_e
        tax
        beq fu32_done
fu32_1:
        lsr ft0
        ror ft1
        ror ft2
        ror ft3
        dex
        bne fu32_1
fu32_done:
        rts

; ===================================================================
; 文字列から数へ
; ===================================================================

; txtptr の位置から数を読んで FAC に置く(先頭の + - も読む)。
; 読み終わると txtptr は数の次の文字を指す
fin:
        jsr fac_zero
        stz fin_dexp            ; 読むあいだは fin_dexph と合わせた16ビット
        stz fin_dexph
        stz fin_pt
        stz fin_neg
        stz fin_nd
        jsr chrgot
        cmp #'-'
        bne fin_p
        dec fin_neg
        bra fin_next
fin_p:
        cmp #'+'
        beq fin_next
        jsr chrgot              ; C を「数字か」に戻す
        bra fin_loop
fin_next:
        jsr chrget
fin_loop:
        bcs fin_notdig          ; chrget: 数字なら C=0
        and #$0F
        pha
        lda fac_e               ; 先頭の0は桁に数えない
        bne fin_count
        pla
        pha
        beq fin_zero
fin_count:
        lda fin_nd
        cmp #10
        bcs fin_skip            ; 10桁を超えた分は読み捨てる
        inc fin_nd
fin_zero:
        jsr mul10
        jsr fac_to_arg
        pla
        jsr fac_u8
        jsr fadd
        lda fin_pt
        beq fin_next
        lda fin_dexp            ; 小数点より後の桁: 指数を1減らす(16ビット。文字列は255文字までなので正確に数えられる)
        bne fin_dd
        dec fin_dexph
fin_dd:
        dec fin_dexp
        bra fin_next
fin_skip:
        pla
        lda fin_pt
        bne fin_next
        inc fin_dexp            ; 小数点より前の読み捨てた桁: 指数を1増やす(16ビット)
        bne fin_next
        inc fin_dexph           ; 読み捨てる桁が256を超えたとき。文字列は255文字までなので今は通らないが、
                                ; 16ビットの数え方をそろえておく
        bra fin_next
fin_notdig:
        cmp #'.'
        bne fin_e
        lda fin_pt
        bne fin_endj            ; 2つ目の小数点で終わり
        inc fin_pt
        bra fin_next
fin_e:
        cmp #'E'
        beq fin_e1
        cmp #'e'
        beq fin_e1
fin_endj:
        jmp fin_clamp           ; 数の終わり(fin_clamp は遠いので中継する)
fin_e1:
        ; 指数部: E [+-] 数字(fin_evh と合わせた16ビット)
        stz fin_ev
        stz fin_evh
        stz fin_eneg
        jsr chrget
        cmp #'-'
        bne fin_ep
        dec fin_eneg
        bra fin_en
fin_ep:
        cmp #'+'
        beq fin_en
        jsr chrgot
        bra fin_eloop
fin_en:
        jsr chrget
fin_eloop:
        bcs fin_edone
        and #$0F
        sta ft0
        lda fin_evh             ; ev = ev × 10 + 数字。100 以上に10をかけるなら 1000 にする
        bne fin_ebig            ; (1000 は、桁から決めた指数(最大 ±255)と打ち消し合っても、
        lda fin_ev              ;  必ずあふれるか 0 になる大きさ)
        cmp #100
        bcs fin_ebig
        asl                     ; 2ev(198 以下)
        sta ft1
        asl                     ; 4ev
        rol fin_evh
        asl                     ; 8ev
        rol fin_evh
        clc
        adc ft1                 ; 8ev + 2ev
        bcc fin_e2
        inc fin_evh
fin_e2:
        clc
        adc ft0
        sta fin_ev
        bcc fin_en
        inc fin_evh
        bra fin_en
fin_ebig:
        lda #<1000
        sta fin_ev
        lda #>1000
        sta fin_evh
        bra fin_en
fin_edone:
        bit fin_eneg            ; 指数 = 桁から決めた指数 ± 指数部(16ビット)
        bmi fin_esub
        clc
        lda fin_dexp
        adc fin_ev
        sta fin_dexp
        lda fin_dexph
        adc fin_evh
        sta fin_dexph
        bra fin_clamp
fin_esub:
        sec
        lda fin_dexp
        sbc fin_ev
        sta fin_dexp
        lda fin_dexph
        sbc fin_evh
        sta fin_dexph
fin_clamp:
        ; 16ビットの指数を、符号付き1バイト(-128 から 127)に収める。
        ; 収まらないほど大きければ答えは ?OV、小さければ 0 なので、端に止めてよい
        lda fin_dexp
        bmi fcl_neg
        lda fin_dexph           ; 下位が 0-127: 上位が 0 なら収まる
        beq fin_scale
        bmi fcl_min
        bra fcl_max
fcl_neg:
        lda fin_dexph           ; 下位が 128-255: 上位が $FF なら収まる
        cmp #$FF
        beq fin_scale
        tax
        bmi fcl_min
fcl_max:
        lda #127
        sta fin_dexp
        bra fin_scale
fcl_min:
        lda #$80
        sta fin_dexp
fin_scale:
        lda fin_dexp            ; 10 のべき乗をかける
        beq fin_sign
        bmi fin_down
        jsr mul10
        dec fin_dexp
        bra fin_scale
fin_down:
        jsr div10
        inc fin_dexp
        bra fin_scale
fin_sign:
        lda fin_neg
        beq fin_done
        jsr fac_neg
fin_done:
        rts

; ===================================================================
; 数から文字列へ
; ===================================================================

; FAC を文字列にして fbuffr に置く(0 で終わる)。先頭は符号(空白か -)
; 有効数字9桁。大きすぎる数、小さすぎる数は 1.2345E+12 の形にする
fout:
        lda #' '
        ldx fac_s
        bpl fo_1
        lda #'-'
fo_1:
        sta fbuffr
        lda fac_e
        bne fo_nz
        lda #'0'
        sta fbuffr+1
        stz fbuffr+2
        rts
fo_nz:
        stz fac_s
        stz fin_dexp
fo_big:
        lda #<c_1e9             ; 1E9 以上なら 10 で割る
        ldy #>c_1e9
        jsr arg_ld
        jsr fcmp_nr
        cmp #1
        beq fo_small
        jsr div10
        inc fin_dexp
        bra fo_big
fo_small:
        lda #<c_1e8             ; 1E8 未満なら 10 をかける
        ldy #>c_1e8
        jsr arg_ld
        jsr fcmp_nr
        cmp #1
        bne fo_round
        jsr mul10
        dec fin_dexp
        bra fo_small
fo_round:
        lda #<c_half            ; 四捨五入して整数に
        ldy #>c_half
        jsr arg_ld
        jsr fadd
        jsr fac_u32             ; 切り捨て(丸めると x.97 が繰り上がってしまう)
        lda ft0                 ; 1E9 になったら 1E8 にする
        cmp #$3B
        bne fo_digits
        lda ft1
        cmp #$9A
        bne fo_digits
        lda ft2
        cmp #$CA
        bne fo_digits
        lda ft3
        bne fo_digits
        lda #$05
        sta ft0
        lda #$F5
        sta ft1
        lda #$E1
        sta ft2
        stz ft3
        inc fin_dexp
fo_digits:
        ldx #0                  ; 10^8 から順に引いて各桁を出す
        ldy #0
fo_d1:
        lda #'0'
        sta fodig,Y
fo_d2:
        sec
        lda ft3
        sbc pow10_tab+3,X
        sta ft7
        lda ft2
        sbc pow10_tab+2,X
        sta ft6
        lda ft1
        sbc pow10_tab+1,X
        sta ft5
        lda ft0
        sbc pow10_tab,X
        bcc fo_d3
        sta ft0
        lda ft5
        sta ft1
        lda ft6
        sta ft2
        lda ft7
        sta ft3
        lda fodig,Y
        inc
        sta fodig,Y
        bra fo_d2
fo_d3:
        inx
        inx
        inx
        inx
        iny
        cpy #9
        bne fo_d1
        ; 最後の0を除いた桁数
        ldy #9
fo_t1:
        cpy #1
        beq fo_t2
        lda fodig-1,Y
        cmp #'0'
        bne fo_t2
        dey
        bra fo_t1
fo_t2:
        sty fo_nd
        clc                     ; 小数点の位置 = 指数 + 9
        lda fin_dexp
        adc #9
        sta fo_e
        ldx #1                  ; fbuffr の書く位置
        ldy #0                  ; fodig の読む位置
        lda fo_e
        bmi fo_sci
        beq fo_frac
        cmp #10
        bcs fo_sci
        ; 1 <= E <= 9: 整数部と小数部
fo_i1:
        cpy fo_e
        beq fo_i3
        lda #'0'
        cpy fo_nd
        bcs fo_i2
        lda fodig,Y
fo_i2:
        sta fbuffr,X
        inx
        iny
        bra fo_i1
fo_i3:
        cpy fo_nd
        bcc *+5
        jmp fo_end
        lda #'.'
        sta fbuffr,X
        inx
fo_i4:
        lda fodig,Y
        sta fbuffr,X
        inx
        iny
        cpy fo_nd
        bne fo_i4
        bra fo_end
fo_frac:
        ; E = 0 か -1: .ddd か .0ddd
        lda #'.'
        sta fbuffr,X
        inx
        lda fo_e
        beq fo_f2
        lda #'0'
        sta fbuffr,X
        inx
fo_f2:
        lda fodig,Y
        sta fbuffr,X
        inx
        iny
        cpy fo_nd
        bne fo_f2
        bra fo_end
fo_sci:
        cmp #$FF                ; E = -1 も小数の形
        beq fo_frac
        lda fodig               ; d.dddE+xx
        sta fbuffr,X
        inx
        iny
        cpy fo_nd
        beq fo_s2
        lda #'.'
        sta fbuffr,X
        inx
fo_s1:
        lda fodig,Y
        sta fbuffr,X
        inx
        iny
        cpy fo_nd
        bne fo_s1
fo_s2:
        lda #'E'
        sta fbuffr,X
        inx
        lda fo_e                ; 指数 = E - 1
        sec
        sbc #1
        bmi fo_sneg
        ldy #'+'
        bra fo_s3
fo_sneg:
        eor #$FF
        clc
        adc #1
        ldy #'-'
fo_s3:
        pha
        tya
        sta fbuffr,X
        inx
        pla
        ldy #'0'-1              ; 10 の位
fo_s4:
        iny
        sec
        sbc #10
        bcs fo_s4
        adc #10+'0'
        pha
        tya
        sta fbuffr,X
        inx
        pla
        sta fbuffr,X
        inx
fo_end:
        stz fbuffr,X
        rts

; ---- エラー ----
err_ov:
        ldx #EN_OV
        jmp b_error
err_div0:
        ldx #EN_DIV0
        jmp b_error
err_fc:
        ldx #EN_FC
        jmp b_error
