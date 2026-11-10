; PX-65 BASIC: 数学関数
;
; 係数は basic_const.s(tools/mkfpconst.js)にある。

; FAC を fpt に置く / fpt から読む(A/Y を使う短い呼び方)
st3:
        lda #<fpt3
        ldy #>fpt3
        jmp fac_st
ld3:
        lda #<fpt3
        ldy #>fpt3
        jmp fac_ld
arg3:
        lda #<fpt3
        ldy #>fpt3
        jmp arg_ld
st4:
        lda #<fpt4
        ldy #>fpt4
        jmp fac_st
ld4:
        lda #<fpt4
        ldy #>fpt4
        jmp fac_ld
arg4:
        lda #<fpt4
        ldy #>fpt4
        jmp arg_ld
argc:                           ; ARG = 定数(A/Y)
        jmp arg_ld

; FAC = FAC × 定数(A/Y)
mulc:
        jsr arg_ld
        jmp fmul

; FAC = FAC + 定数(A/Y)
addc:
        jsr arg_ld
        jmp fadd

; ===================================================================
; 多項式: FAC = c0 x^n + c1 x^(n-1) + … + cn(A/Y = 係数の表。先頭は個数)
; ===================================================================
poly:
        sta poly_p
        sty poly_p+1
        lda #<fpt5              ; x を置く
        ldy #>fpt5
        jsr fac_st
        lda poly_p              ; 係数の数
        sta fptr
        lda poly_p+1
        sta fptr+1
        lda (fptr)
        sta poly_n
        jsr poly_next
        jsr fac_ld              ; 最初の係数
pl_1:
        dec poly_n
        beq pl_done
        lda #<fpt5              ; FAC = FAC × x + 次の係数
        ldy #>fpt5
        jsr arg_ld
        jsr fmul
        jsr poly_next
        jsr arg_ld
        jsr fadd
        bra pl_1
pl_done:
        rts
; poly_p を次の係数へ進め、その番地を A/Y に
poly_next:
        clc
        lda poly_p
        adc #1
        sta poly_p
        bcc pn_a
        inc poly_p+1
pn_a:
        lda poly_p
        ldy poly_p+1
        pha                     ; 次のためにさらに4バイト進めておく
        clc
        adc #4
        sta poly_p
        bcc pn_b
        inc poly_p+1
pn_b:
        pla
        rts

; ===================================================================
; SQR
; ===================================================================
fn_sqr:
        jsr par_num
fsqr:
        lda fac_e
        beq fq_done             ; 0
        lda fac_s
        bpl fq_1
        jmp err_fc
fq_1:
        jsr st3                 ; x
        lda fac_e               ; 最初の見当: 指数を半分に
        sec
        sbc #128
        cmp #$80
        ror
        clc
        adc #128
        sta fac_e
        jsr st4                 ; g
        lda #5
        sta poly_n
fq_2:
        jsr arg3                ; g = (g + x / g) / 2
        jsr ld4
        jsr fdiv
        jsr arg4
        jsr fadd
        lda fac_e
        beq fq_3
        dec fac_e
fq_3:
        jsr st4
        dec poly_n
        bne fq_2
fq_done:
        rts

; ===================================================================
; EXP, LN, LOG
; ===================================================================
fn_exp:
        jsr par_num
fexp:
        lda fac_s               ; |x| > 89 なら、正はオーバーフロー、負は 0(大まかな判定)
        pha
        stz fac_s
        lda #<c_89
        ldy #>c_89
        jsr arg_ld
        jsr fcmp
        tax
        pla
        sta fac_s
        cpx #$FF
        bne fe_ok
        lda fac_s
        bmi fe_zero
        jmp err_ov
fe_zero:
        jmp fac_zero
fe_ok:
        jsr st3                 ; x
        lda #<c_inv_ln2         ; n = INT(x / ln2)
        ldy #>c_inv_ln2
        jsr mulc
        jsr fac_int
        jsr st4
        jsr getint16            ; n(-129 から 128)
        lda linnum+1            ; 指数に足せるのは -128 から 127。
        bne fe_nm               ; n < -128 なら答えは 2^-128 より小さいので 0、n > 127 ならあふれる
        lda linnum
        bpl fe_nok
        jmp err_ov
fe_nm:
        lda linnum
        bmi fe_nok
        jmp fac_zero
fe_nok:
        lda linnum
        sta exp_n
        ; r = x - n × ln2。ln2 を上位(n をかけても正確)と下位に分けて精度を保つ
        jsr ld4
        lda #<c_ln2hi
        ldy #>c_ln2hi
        jsr mulc
        jsr arg3
        jsr fsub                ; x - n × ln2(上位)
        jsr st3
        jsr ld4
        lda #<c_ln2lo
        ldy #>c_ln2lo
        jsr mulc
        jsr arg3
        jsr fsub                ; - n × ln2(下位)
        lda #<exp_poly
        ldy #>exp_poly
        jsr poly                ; e^r
        lda fac_e               ; 指数に n を足す
        beq fex_done
        clc
        adc exp_n
        tax
        lda exp_n
        bmi fe_neg
        bcs fe_ov               ; 255 を超えた
        stx fac_e
fex_done:
        rts
fe_neg:
        bcc fe_zero             ; 0 以下になった
        cpx #0
        beq fe_zero
        stx fac_e
        rts
fe_ov:
        jmp err_ov

fn_ln:
        jsr par_num
fln:
        lda fac_s
        bmi fl_fc
        lda fac_e
        bne fln_1
fl_fc:
        jmp err_fc
fln_1:
        sec                     ; k = 指数 - 128、m = 0.5 以上 1 未満
        sbc #128
        sta exp_n
        lda #128
        sta fac_e
        lda #<c_sqrthalf        ; m < √0.5 なら m を2倍、k を1減らす
        ldy #>c_sqrthalf
        jsr arg_ld
        jsr fcmp
        cmp #1
        bne fl_2
        inc fac_e
        dec exp_n
fl_2:
        jsr st3                 ; m
        lda #<c_one             ; s = (m - 1) / (m + 1)
        ldy #>c_one
        jsr arg_ld
        jsr fadd                ; m + 1
        jsr st4
        jsr ld3
        lda #<c_mone
        ldy #>c_mone
        jsr addc                ; m - 1
        jsr fac_to_arg
        jsr ld4
        jsr fdiv                ; (m - 1) / (m + 1)
        jsr st3                 ; s
        jsr fac_to_arg
        jsr fmul                ; s²
        lda #<ln_poly
        ldy #>ln_poly
        jsr poly
        jsr arg3
        jsr fmul                ; s × p
        lda fac_e               ; × 2
        beq fl_3
        inc fac_e
fl_3:
        jsr st4
        lda exp_n               ; + k × ln2
        ldy #0
        cmp #$80
        bcc fl_4
        dey
fl_4:
        jsr fac_s16
        lda #<c_ln2
        ldy #>c_ln2
        jsr mulc
        jsr arg4
        jmp fadd

fn_log:
        jsr par_num
        jsr fln
        lda #<c_inv_ln10
        ldy #>c_inv_ln10
        jmp mulc

; ===================================================================
; SIN, COS, TAN, ATN
; ===================================================================

; 角度の単位が度ならラジアンにする。FAC は 0 以上(trig_abs の後)。
; 度のときは、先に x - 360 × INT(x / 360) で 0〜360 度に直し(360 は有効数字が少ないので、
; 商が 2^26 未満なら掛けても正確。それ以上は FC)、さらに 90 度ずつ引いて 0〜90 度未満の r にする。
; 90 度を引く計算は正確なので、90 度、180 度などはちょうど r = 0 になる(COS(90) が 0、TAN(90) が /0)。
; r が 45 度を超えたら 90 - r(これも正確)にして、90 度の近くで桁が落ちないようにする。
; 戻ると sin_q = 引いた 90 度の数(0〜3)、bit7 = 90 - r にした印。ラジアンなら sin_q = 0。
; fsin に渡す象限は trig_q で求める
to_rad:
        stz sin_q
        lda angmode
        bne tr_deg
        rts
tr_deg:
        jsr st3                 ; x
        lda #<c_inv360
        ldy #>c_inv360
        jsr mulc
        jsr fac_int             ; n = INT(x / 360)
        lda fac_e
        cmp #128+27
        bcs tr_fc
        lda #<c_360
        ldy #>c_360
        jsr mulc
        jsr arg3
        jsr fsub                ; y = x - 360 × n
tr_fix:
        lda fac_e
        beq tr_ok               ; r = 0
        bit fac_s
        bpl tr_hi
        lda #<c_90              ; r < 0(n が1ずれたとき): 90 度を足す
        ldy #>c_90
        jsr addc
        dec sin_q
        bra tr_fix
tr_hi:
        lda #<c_90
        ldy #>c_90
        jsr arg_ld
        jsr fcmp
        cmp #1
        beq tr_ok               ; r < 90
        jsr fac_neg             ; r - 90 = -(90 - r)
        lda #<c_90
        ldy #>c_90
        jsr addc
        jsr fac_neg
        inc sin_q
        bra tr_fix
tr_ok:
        lda sin_q
        and #3
        sta sin_q
        lda #<c_45              ; r > 45 なら 90 - r
        ldy #>c_45
        jsr arg_ld
        jsr fcmp
        cmp #$FF
        bne tr_rad
        lda #<c_90
        ldy #>c_90
        jsr arg_ld
        jsr fsub
        lda #$80
        tsb sin_q
tr_rad:
        lda #<c_deg2rad
        ldy #>c_deg2rad
        jmp mulc
tr_fc:
        jmp err_fc

; to_rad の後、X = 0(sin)か 1(cos)のときに fsin に渡す象限を A に。
; 角度 = 90 × k + r なら k + X。90 - r にしたとき(角度 = 90 × (k+1) - r)は
; sin(90 × m - r) = sin(r + (2 - m) × 90)(m = k + 1 + X)なので 1 - k - X
trig_q:
        txa
        clc
        adc sin_q
        bit sin_q
        bpl tq_1
        eor #$FF                ; -(k + X) - 1
        clc
        adc #2                  ; 1 - k - X
tq_1:
        and #3
        rts

; 引数の符号を trig_s に取っておき、FAC を絶対値にする。
; 負の小さい角度を 360 度や π/2 の近くへ移すと桁が落ちるので、絶対値で計算して
; SIN と TAN(奇関数)は最後に符号を戻す。COS(偶関数)は戻さない
trig_abs:
        lda fac_s
        sta trig_s
        stz fac_s
        rts
; 引数が負なら FAC の符号を変える
trig_sign:
        bit trig_s
        bpl tsg_1
        jmp fac_neg
tsg_1:
        rts

fn_sin:
        jsr par_num
        jsr trig_abs
        jsr to_rad
        ldx #0
        jsr trig_q
        jsr fsin
        bra trig_sign
fn_cos:
        jsr par_num
        jsr trig_abs
        jsr to_rad
        ldx #1                  ; cos(x) = sin(x + π/2)
        jsr trig_q
        jmp fsin
fn_tan:
        jsr par_num
        jsr trig_abs
        jsr to_rad
        ldx #0                  ; 象限(fsin が sin_q を書き換えるので先に両方求める)
        jsr trig_q
        pha                     ; sin の象限
        ldx #1
        jsr trig_q
        pha                     ; cos の象限
        lda #<fpt6              ; x を取っておく
        ldy #>fpt6
        jsr fac_st
        pla
        jsr fsin                ; cos
        lda #<fpt7
        ldy #>fpt7
        jsr fac_st
        lda #<fpt6
        ldy #>fpt6
        jsr fac_ld
        pla
        jsr fsin                ; sin
        jsr fac_to_arg
        lda #<fpt7
        ldy #>fpt7
        jsr fac_ld
        jsr fdiv                ; sin / cos
        bra trig_sign

; FAC = sin(FAC + A × π/2)(ラジアン)。A=0 で sin、1 で cos
; q = INT(x / (π/2) + 0.5)(いちばん近い π/2 の倍数)、r = x - q × π/2(π/2 を5つに分けて精度を保つ)。
; r は -π/4 から π/4 なので、答えが 0 に近いとき(x が π/2 の倍数の近く)も r が小さくなって桁が落ちない。
; 象限 (q + A) mod 4 で sin(r) か cos(r) = sin(π/2 - |r|) を選び、符号を決める
fsin:
        sta sin_q
        jsr st3                 ; x
        lda #<c_2_pi
        ldy #>c_2_pi
        jsr mulc
        lda #<c_half            ; 四捨五入
        ldy #>c_half
        jsr addc
        jsr fac_int             ; q
        lda fac_e               ; q が 2^32 以上(x が約 6.7E9 以上)なら正確に引けないので FC
        cmp #128+33
        bcc fsn_qok
        jmp err_fc
fsn_qok:
        jsr st4
        ; q mod 4 = q - 4 × INT(q / 4)(q が大きくても使えるように浮動小数点で)
        lda fac_e
        beq fsn_q0
        sec
        sbc #2
        bcc fsn_q0
        beq fsn_q0
        sta fac_e               ; q / 4
        jsr fac_int
        lda fac_e
        beq fsn_qz
        clc
        adc #2
        sta fac_e               ; 4 × INT(q / 4)
fsn_qz:
        jsr fac_to_arg
        jsr ld4
        jsr swap_fa
        jsr fsub                ; q - 4 × INT(q / 4)
        jsr getint16
        lda linnum
        bra fsn_q1
fsn_q0:
        jsr ld4                 ; |q| が小さい
        jsr getint16
        lda linnum
fsn_q1:
        clc
        adc sin_q
        and #3
        sta sin_q
        ; r = x - q × π/2。π/2 を5つに分けて順に引く(1〜4 は8ビットなので、q が 2^24 未満なら掛けても正確)
        lda #<c_pio2_1
        ldy #>c_pio2_1
        jsr fsn_sub
        lda #<c_pio2_2
        ldy #>c_pio2_2
        jsr fsn_sub
        lda #<c_pio2_3
        ldy #>c_pio2_3
        jsr fsn_sub
        lda #<c_pio2_4
        ldy #>c_pio2_4
        jsr fsn_sub
        lda #<c_pio2_5
        ldy #>c_pio2_5
        jsr fsn_sub             ; r
        ; |q| が大きいと x × 2/π に小数部の桁が残らず、q が1ずれることがある。
        ; |r| が π/4 以下になるまで、π/2 を足し引きして象限を合わせる
fsn_fix:
        lda fac_e
        beq fsn_rok             ; r = 0
        lda fac_s
        pha
        stz fac_s
        lda #<c_pio4
        ldy #>c_pio4
        jsr arg_ld
        jsr fcmp
        tax
        pla
        sta fac_s
        cpx #$FF
        bne fsn_rok             ; |r| <= π/4
        bit fac_s
        bpl fsn_hi
        lda #<c_halfpi          ; r < -π/4: r + π/2、象限を1つ戻す
        ldy #>c_halfpi
        jsr addc
        dec sin_q
        bra fsn_fix
fsn_hi:
        jsr fac_neg             ; r > π/4: r - π/2、象限を1つ進める
        lda #<c_halfpi
        ldy #>c_halfpi
        jsr addc
        jsr fac_neg
        inc sin_q
        bra fsn_fix
fsn_rok:
        lda sin_q               ; 象限が奇数なら cos(r) = sin(π/2 - |r|)
        and #1
        beq fsn_3
        lda fac_e               ; r = 0 なら cos(0) = 1 ちょうど
        bne fsn_c               ; (多項式で sin(π/2) を求めると 1 より 1ビット小さくなる)
        lda #<c_one
        ldy #>c_one
        jsr fac_ld
        bra fsn_sg
fsn_c:
        stz fac_s
        lda #<c_halfpi
        ldy #>c_halfpi
        jsr arg_ld
        jsr fsub
fsn_3:
        jsr st3
        jsr fac_to_arg
        jsr fmul                ; r²
        lda #<sin_poly
        ldy #>sin_poly
        jsr poly
        jsr arg3
        jsr fmul                ; r × p(r²)
fsn_sg:
        lda sin_q               ; 象限が 2, 3 なら負
        and #2
        beq fsn_4
        jsr fac_neg
fsn_4:
        rts

; fpt3 = fpt3 - q(fpt4) × 定数(A/Y)。FAC にも同じ値を残す
fsn_sub:
        pha
        phy
        jsr ld4
        ply
        pla
        jsr mulc
        jsr arg3
        jsr fsub
        jmp st3

fn_atn:
        jsr par_num
        lda fac_s
        sta atn_s
        stz fac_s
        stz atn_f               ; bit0: 1/x にした、bit1: π/6 ずらした
        lda #<c_one             ; |x| > 1 なら 1/x
        ldy #>c_one
        jsr arg_ld
        jsr fcmp
        cmp #$FF
        bne fa_2
        jsr fdiv_1x
        lda #1
        tsb atn_f
fa_2:
        lda #<c_tan15           ; x > tan 15° なら (x√3 - 1) / (x + √3)
        ldy #>c_tan15
        jsr arg_ld
        jsr fcmp
        cmp #$FF
        bne fa_3
        jsr st3
        lda #<c_sqrt3
        ldy #>c_sqrt3
        jsr addc                ; x + √3
        jsr st4
        jsr ld3
        lda #<c_sqrt3
        ldy #>c_sqrt3
        jsr mulc
        lda #<c_mone
        ldy #>c_mone
        jsr addc                ; x√3 - 1
        jsr fac_to_arg
        jsr ld4
        jsr fdiv
        lda #2
        tsb atn_f
fa_3:
        jsr st3                 ; t
        jsr fac_to_arg
        jsr fmul                ; t²
        lda #<atn_poly
        ldy #>atn_poly
        jsr poly
        jsr arg3
        jsr fmul                ; t × p(t²)
        lda atn_f
        and #2
        beq fa_4
        lda #<c_pi6
        ldy #>c_pi6
        jsr addc
fa_4:
        lda atn_f
        and #1
        beq fa_5
        lda #<c_halfpi          ; π/2 - y
        ldy #>c_halfpi
        jsr arg_ld
        jsr fsub
fa_5:
        lda atn_s
        sta fac_s
        lda fac_e
        bne fa_6
        stz fac_s
fa_6:
        lda angmode
        beq fa_7
        lda #<c_rad2deg
        ldy #>c_rad2deg
        jmp mulc
fa_7:
        rts

; FAC = 1 / FAC
fdiv_1x:
        lda #<c_one
        ldy #>c_one
        jsr arg_ld              ; ARG = 1
        jmp fdiv

; ===================================================================
; べき乗: FAC = ARG ^ FAC
; ===================================================================
fpow:
        lda #<fpt6              ; 指数 y
        ldy #>fpt6
        jsr fac_st
        jsr swap_fa
        jsr st3                 ; 底 x(fpt3)
        lda #<fpt6
        ldy #>fpt6
        jsr fac_ld
        lda fac_e
        bne fpw_1
        lda #<c_one             ; x^0 = 1
        ldy #>c_one
        jmp fac_ld
fpw_1:
        lda fpt3                ; 底が0
        bne fpw_2
        lda fac_s
        bpl fp_zero
        jmp err_div0
fp_zero:
        jmp fac_zero
fpw_2:
        ; 指数が -32767 から 32767 の整数なら、かけ算をくり返す(正確)
        lda fac_e
        cmp #128+16
        bcs fp_genj
        cmp #129
        bcs fp_int
fp_genj:
        jmp fp_gen              ; |y| < 1 か大きすぎる
fp_int:
        jsr fac_chop
        beq fp_int2
        jmp fp_gen2             ; 小数がある
fp_int2:
        jsr getint16            ; n
        ; |n| が 32 を超え、底が整数でも2のべきでもないなら、EXP(n × LN(|x|)) で計算する。
        ; 底が 1 に近い小数(1.0001^10000 など)は、かけ算をくり返すと誤差がたまるため。
        ; 底が整数か2のべきなら、かけ算のほうが正確(ちょうど表せる答えはちょうどになる)
        lda linnum+1
        bmi fpb_neg
        bne fpb_big
        lda linnum
        cmp #33
        bcc fp_mul              ; 0〜32
        bra fpb_big
fpb_neg:
        cmp #$FF
        bne fpb_big
        lda linnum
        cmp #$E0
        bcs fp_mul              ; -32〜-1
fpb_big:
        lda fpt3+1              ; 底の仮数が 1000…0 なら2のべき
        and #$7F
        ora fpt3+2
        ora fpt3+3
        ora fpt3+4
        beq fp_mul
        lda fpt3                ; |x| >= 2^32 なら整数、|x| < 1 なら整数でない
        cmp #128+32
        bcs fp_mul
        cmp #129
        bcc fpb_gen
        jsr ld3
        jsr fac_chop
        beq fp_mul              ; 小数がない
fpb_gen:
        lda fpt3+1
        bmi fpb_ng
        jmp fp_gen2
fpb_ng:
        and #$7F                ; 底が負: |x| で計算し、n が奇数なら符号を変える
        sta fpt3+1
        lda linnum
        and #1
        pha
        jsr fp_gen2
        pla
        beq fpb_done
        jmp fac_neg
fpb_done:
        rts
fp_mul:
        lda linnum
        sta pow_n
        lda linnum+1
        sta pow_n+1
        bpl fp_i1
        sec                     ; |n|
        lda #0
        sbc pow_n
        sta pow_n
        lda #0
        sbc pow_n+1
        sta pow_n+1
        ; 負の指数: ふつうは x^|n| を求めてから逆数にする(誤差が小さい)。
        ; ただし x^|n| が範囲を超えそうなとき(|n| × |log2 x| >= 127)は、
        ; 途中であふれないように、先に底を逆数にしてから |n| 乗する
        lda pow_n+1
        bne fp_inv
        lda fpt3                ; 底の指数 e。|log2 x| <= k = e-128(e>128)、129-e(e<=128)
        cmp #129
        bcc fp_k1
        sbc #128
        bra fp_k2
fp_k1:
        lda #129
        sec
        sbc fpt3
fp_k2:
        sta bt0
        ldx pow_n               ; k を |n| 回足して 127 以上になるか
        lda #0
fp_k3:
        clc
        adc bt0
        bcs fp_inv
        cmp #127
        bcs fp_inv
        dex
        bne fp_k3
        bra fp_i1
fp_inv:
        jsr ld3                 ; 底 = 1/底(1/底があふれるなら答えもあふれる)
        jsr fdiv_1x
        jsr st3
        stz linnum+1            ; 最後の逆数は要らない
fp_i1:
        lda #<c_one             ; 結果 = 1(fpt4)、底(fpt3)
        ldy #>c_one
        jsr fac_ld
        jsr st4
fp_i2:
        lda pow_n
        ora pow_n+1
        beq fp_i4
        lsr pow_n+1
        ror pow_n
        bcc fp_i3
        jsr arg3                ; 結果 × 底
        jsr ld4
        jsr fmul
        jsr st4
fp_i3:
        lda pow_n
        ora pow_n+1
        beq fp_i4
        jsr ld3                 ; 底 × 底
        jsr fac_to_arg
        jsr fmul
        jsr st3
        bra fp_i2
fp_i4:
        jsr ld4
        lda linnum+1            ; 指数が負なら 1/結果
        bpl fp_i5
        jmp fdiv_1x
fp_i5:
        rts
fp_gen2:
        lda #<fpt6              ; 切り捨てで壊したので y を読み直す
        ldy #>fpt6
        jsr fac_ld
fp_gen:
        lda fpt3+1              ; 底が負ならできない
        bpl fp_g1
        jmp err_fc
fp_g1:
        jsr ld3                 ; exp(y × ln x)
        jsr fln
        lda #<fpt6
        ldy #>fpt6
        jsr arg_ld
        jsr fmul
        jmp fexp

; ===================================================================
; RND, RANDOMIZE
; ===================================================================
fn_rnd:
        jsr par_num
        lda fac_e
        bne frn_1
        lda #<rndlast           ; RND(0): 直前の値
        ldy #>rndlast
        jmp fac_ld
frn_1:
        lda fac_s
        bpl fr_gen
        lda fac_m1              ; 負: その数で種を決める
        eor fac_e
        sta rndseed
        lda fac_m2
        sta rndseed+1
        lda fac_m3
        sta rndseed+2
        lda fac_m4
        sta rndseed+3
        jsr seed_fix
fr_gen:
        jsr xorshift
        lda rndseed+3           ; 0 以上 1 未満
        sta fac_m1
        lda rndseed+2
        sta fac_m2
        lda rndseed+1
        sta fac_m3
        lda rndseed
        sta fac_m4
        stz fac_x
        stz fac_s
        lda #128
        sta fac_e
        jsr fac_norm
        lda #<rndlast
        ldy #>rndlast
        jsr fac_st
        stz valtyp
        rts

; 種が0なら1にする
seed_fix:
        lda rndseed
        ora rndseed+1
        ora rndseed+2
        ora rndseed+3
        bne sfx_1
        inc rndseed
sfx_1:
        rts

; 32ビットの xorshift(rndseed は下位から)
xorshift:
        ; x ^= x << 13
        stz bt0
        lda rndseed
        sta bt1
        lda rndseed+1
        sta bt2
        lda rndseed+2
        sta bt3
        ldx #5
xs_1:
        asl bt0
        rol bt1
        rol bt2
        rol bt3
        dex
        bne xs_1
        jsr xs_xor
        ; x ^= x >> 17
        lda rndseed+2
        sta bt0
        lda rndseed+3
        sta bt1
        stz bt2
        stz bt3
        lsr bt1
        ror bt0
        jsr xs_xor
        ; x ^= x << 5
        lda rndseed
        sta bt0
        lda rndseed+1
        sta bt1
        lda rndseed+2
        sta bt2
        lda rndseed+3
        sta bt3
        ldx #5
xs_2:
        asl bt0
        rol bt1
        rol bt2
        rol bt3
        dex
        bne xs_2
xs_xor:
        ldx #3
xs_3:
        lda rndseed,X
        eor bt0,X
        sta rndseed,X
        dex
        bpl xs_3
        rts

st_randomize:
        lda ticks
        eor rndseed
        sta rndseed
        lda ticks+1
        eor rndseed+1
        sta rndseed+1
        jsr seed_fix
        jmp xorshift
