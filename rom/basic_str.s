; PX-65 BASIC: 文字列
;
; 文字列の記述子は3バイト(長さ、番地の下位、上位)。文字列の本体は STRTOP($7FFF)の手前から下へ
; 積んでいく(fretop が下端)。プログラムの中の "..." は、プログラムの中を指したまま使う。
; 足りなくなったら、使われている文字列だけを上へ詰める(garbag)。

gc_end     = $03F3          ; 2 ガーベジコレクション: 配列の終わり
gc_len     = $03F5          ; いちばん上の文字列の長さ
gs_len     = $03F6          ; getspa の長さ
str_save   = $03F7          ; VAL で一時的に 0 にしたバイト
sub_lo     = $03F8          ; 部分文字列の元の一時記述子(番地の下位。上位は >tempst)
ft_a       = $03F9          ; free_ay の作業
ft_b       = $03FA

; ===================================================================
; 一時記述子
; ===================================================================

; 一時記述子を作って FAC をその文字列にする。A = 長さ、X = 番地の下位、Y = 上位
put_temp:
        pha
        lda temppt
        cmp #TEMPMAX
        bcc pt_1
        jmp err_om              ; 式が複雑すぎる
pt_1:
        asl                     ; 3 × temppt
        adc temppt
        phx
        tax
        pla
        sta tempst+1,X
        tya
        sta tempst+2,X
        pla
        sta tempst,X
        txa
        clc
        adc #<tempst
        sta fac_m1
        lda #>tempst
        sta fac_m2
        inc temppt
        lda #$FF
        sta valtyp
        stz fac_x
        stz fac_e
        rts

; FAC の文字列が一番上の一時記述子なら、それを捨てる
free_fac:
        lda fac_m1
        ldy fac_m2
        bra free_ay
; ARG の文字列が一番上の一時記述子なら、それを捨てる
free_arg:
        lda arg_m1
        ldy arg_m2
free_ay:
        cpy #>tempst
        bne fr_done
        ldx temppt
        beq fr_done
        sta ft_a
        dex
        txa
        sta ft_b
        asl
        adc ft_b                ; 3 × (temppt - 1)
        adc #<tempst
        cmp ft_a
        bne fr_done
        dec temppt
fr_done:
        rts

; FAC の文字列の長さを A に、番地を strp に
fac_str:
        lda fac_m1
        sta strp2
        lda fac_m2
        sta strp2+1
        ldy #1
        lda (strp2),Y
        sta strp
        iny
        lda (strp2),Y
        sta strp+1
        lda (strp2)
        rts

; ===================================================================
; 文字列の領域
; ===================================================================

; A バイトの文字列の場所を取る。strp = 番地。足りなければ詰め直し、それでもなければ OM
getspa:
        sta gs_len
        jsr gs_try
        bcc gs_ok
        jsr garbag
        jsr gs_try
        bcc gs_ok
        jmp err_om
gs_ok:
        rts
gs_try:
        sec                     ; fretop - 長さ
        lda fretop
        sbc gs_len
        tax
        lda fretop+1
        sbc #0
        cmp strend+1            ; >= strend か
        bcc gst_no
        bne gst_yes
        cpx strend
        bcc gst_no
gst_yes:
        sta fretop+1
        stx fretop
        sta strp+1
        stx strp
        clc
        rts
gst_no:
        sec
        rts

; 使われている文字列だけを STRTOP の下に詰める
garbag:
        lda #<STRTOP
        sta gclim
        sta gcnew
        lda #>STRTOP
        sta gclim+1
        sta gcnew+1
gc_round:
        stz gcbest              ; まだ動かしていない中で、一番上の文字列を探す
        stz gcbest+1
        stz gcflag
        jsr gc_scan
        lda gcbest+1
        beq gc_done             ; もうない
        sec                     ; 動かす先 = gcnew - 長さ
        lda gcnew
        sbc gc_len
        sta dest
        lda gcnew+1
        sbc #0
        sta dest+1
        lda gcbest
        sta srcp
        lda gcbest+1
        sta srcp+1
        lda gc_len
        sta movlen
        stz movlen+1
        jsr move_up
        lda dest
        sta gcnew
        lda dest+1
        sta gcnew+1
        lda #1                  ; その文字列を指す記述子を全部書き換える
        sta gcflag
        jsr gc_scan
        lda gcbest
        sta gclim
        lda gcbest+1
        sta gclim+1
        bra gc_round
gc_done:
        lda gcnew
        sta fretop
        lda gcnew+1
        sta fretop+1
        rts

; すべての文字列の記述子について gc_visit を呼ぶ(変数、配列、一時記述子)
gc_scan:
        lda vartab
        sta index2
        lda vartab+1
        sta index2+1
gsc_1:
        lda index2
        cmp arytab
        bne gsc_2
        lda index2+1
        cmp arytab+1
        beq gsc_arr
gsc_2:
        ldy #1
        lda (index2),Y
        bpl gsc_3               ; 数の変数
        clc
        lda index2
        adc #2
        sta gcp
        lda index2+1
        adc #0
        sta gcp+1
        jsr gc_visit
gsc_3:
        clc
        lda index2
        adc #7
        sta index2
        bcc gsc_1
        inc index2+1
        bra gsc_1
gsc_arr:
        lda index2
        cmp strend
        bne gsc_a1
        lda index2+1
        cmp strend+1
        beq gsc_tmp
gsc_a1:
        ldy #2                  ; 配列の終わり
        clc
        lda (index2),Y
        adc index2
        sta gc_end
        iny
        lda (index2),Y
        adc index2+1
        sta gc_end+1
        ldy #1
        lda (index2),Y
        bpl gsc_anext           ; 数の配列
        ldy #4                  ; 最初の要素 = 見出し + 5 + 2 × 次元数
        lda (index2),Y
        asl
        adc #5
        clc
        adc index2
        sta gcp
        lda index2+1
        adc #0
        sta gcp+1
gsc_a2:
        lda gcp
        cmp gc_end
        bne gsc_a3
        lda gcp+1
        cmp gc_end+1
        beq gsc_anext
gsc_a3:
        jsr gc_visit
        clc
        lda gcp
        adc #3
        sta gcp
        bcc gsc_a2
        inc gcp+1
        bra gsc_a2
gsc_anext:
        lda gc_end
        sta index2
        lda gc_end+1
        sta index2+1
        bra gsc_arr
gsc_tmp:
        lda #<tempst
        sta gcp
        lda #>tempst
        sta gcp+1
        ldx #0
gsc_t1:
        cpx temppt
        beq gsc_done
        phx
        jsr gc_visit
        plx
        clc
        lda gcp
        adc #3
        sta gcp
        inx
        bra gsc_t1
gsc_done:
        rts

; gcp の記述子を調べる。gcflag 0: 一番上の文字列を探す、1: 動かした文字列の番地を書き換える
gc_visit:
        lda (gcp)
        beq gv_ret              ; 空の文字列
        ldy #1
        lda (gcp),Y
        tax
        iny
        lda (gcp),Y             ; 番地 = A(上位)X(下位)
        ldy gcflag
        bne gv_update
        ; 文字列の領域の中(>= fretop)か
        cmp fretop+1
        bcc gv_ret
        bne gv_1
        cpx fretop
        bcc gv_ret
gv_1:
        ; まだ動かしていない(< gclim)か
        cmp gclim+1
        bcc gv_2
        bne gv_ret
        cpx gclim
        bcs gv_ret
gv_2:
        ; いままでの候補より上か
        cmp gcbest+1
        bcc gv_ret
        bne gv_best
        cpx gcbest
        bcc gv_ret
        beq gv_ret
gv_best:
        sta gcbest+1
        stx gcbest
        lda (gcp)
        sta gc_len
gv_ret:
        rts
gv_update:
        cmp gcbest+1
        bne gv_ret
        cpx gcbest
        bne gv_ret
        ldy #1
        lda dest
        sta (gcp),Y
        iny
        lda dest+1
        sta (gcp),Y
        rts

; ===================================================================
; 連結と比較
; ===================================================================

; FAC = ARG + FAC(文字列)
str_concat:
        lda arg_m1
        sta strp2
        lda arg_m2
        sta strp2+1
        lda (strp2)
        sta bt0                 ; 左の長さ
        jsr fac_str
        sta bt1                 ; 右の長さ
        clc
        adc bt0
        bcc sc_1
        ldx #EN_LS
        jmp b_error
sc_1:
        sta bt2                 ; 合わせた長さ
        jsr getspa
        lda strp
        sta dest
        lda strp+1
        sta dest+1
        lda arg_m1              ; 左を写す(詰め直しで動いたかもしれないので記述子から読み直す)
        ldy arg_m2
        jsr copy_desc
        clc
        lda dest
        adc bt0
        sta dest
        bcc sc_2
        inc dest+1
sc_2:
        lda fac_m1              ; 右を写す
        ldy fac_m2
        jsr copy_desc
        jsr free_fac
        jsr free_arg
        lda bt2
        ldx strp
        ldy strp+1
        jmp put_temp

; A(下位)Y(上位)の記述子の文字列を dest へ写す(dest は変えない)。X, bt0-bt2 は保存
copy_desc:
        sta strp2
        sty strp2+1
        ldy #1
        lda (strp2),Y
        sta srcp
        iny
        lda (strp2),Y
        sta srcp+1
        lda (strp2)
        tay
        beq cd_done
cd_1:
        dey
        lda (srcp),Y
        sta (dest),Y
        cpy #0
        bne cd_1
cd_done:
        rts

; ARG と FAC の文字列を比べる。A = 1(ARG が大きい)、0、$FF(ARG が小さい)
str_cmp:
        lda arg_m1
        sta strp2
        lda arg_m2
        sta strp2+1
        lda (strp2)
        sta bt0                 ; 左の長さ
        ldy #1
        lda (strp2),Y
        sta index2
        iny
        lda (strp2),Y
        sta index2+1
        jsr fac_str
        sta bt1                 ; 右の長さ。右は strp
        jsr free_fac
        jsr free_arg
        ldy #0
scm_1:
        cpy bt0
        beq scm_lend
        cpy bt1
        beq scm_gt              ; 右が先に終わった
        lda (index2),Y
        cmp (strp),Y
        bne scm_ne
        iny
        bra scm_1
scm_lend:
        cpy bt1
        beq scm_eq
scm_lt:
        lda #$FF
        rts
scm_ne:
        bcc scm_lt
scm_gt:
        lda #1
        rts
scm_eq:
        lda #0
        rts

; ===================================================================
; 代入
; ===================================================================

; forpnt の変数(5バイトか3バイトの記述子)に FAC の値を入れる。型は valtyp
let_value:
        lda valtyp
        bne lv_str
        lda forpnt
        ldy forpnt+1
        jmp fac_st
lv_str:
        jsr fac_str             ; A = 長さ、strp = 本体
        sta bt0
        ; 本体が入力行の中($0300-$03FF)なら、文字列の領域へ写す
        ldx strp+1
        cpx #>LINEBUF
        bne lv_store
        cmp #0
        beq lv_store
        jsr getspa
        lda strp
        sta dest
        lda strp+1
        sta dest+1
        lda fac_m1
        ldy fac_m2
        jsr copy_desc
        lda dest
        sta strp
        lda dest+1
        sta strp+1
lv_store:
        jsr free_fac
        ldy #0
        lda bt0
        sta (forpnt),Y
        iny
        lda strp
        sta (forpnt),Y
        iny
        lda strp+1
        sta (forpnt),Y
        rts

; ===================================================================
; 文字列の関数
; ===================================================================

; ( 文字列の式 ) を読む。A = 長さ、strp = 本体(一時記述子は捨てる)
par_str:
        jsr chkopen
        jsr frmstr
        jsr chkclose
        jsr fac_str
        pha
        jsr free_fac
        pla
        rts

fn_len:
        jsr par_str
        stz valtyp
        jmp fac_u8

fn_asc:
        jsr par_str
        cmp #0
        bne fa_1
        jmp err_fc
fa_1:
        lda (strp)
        stz valtyp
        jmp fac_u8

fn_chrs:
        jsr par_num
        jsr getbyte
make_char:                      ; A の1文字の文字列を作る
        pha
        lda #1
        jsr getspa
        pla
        sta (strp)
        lda #1
make_str:                       ; strp からの A バイトを一時文字列に
        ldx strp
        ldy strp+1
        jmp put_temp

fn_inkeys:
        jsr BIOS_KEYCHK
        bcs make_char
        lda #0
        bra make_str

fn_strs:
        jsr par_num
        jsr fout
        ldx #0                  ; fbuffr の長さ
fst_1:
        lda fbuffr,X
        beq fst_2
        inx
        bra fst_1
fst_2:
        txa
str_from_buf:                   ; fbuffr の A バイトを文字列に
        pha
        jsr getspa
        ply
        phy
fsb_1:
        dey
        bmi fsb_2
        lda fbuffr,Y
        sta (strp),Y
        bra fsb_1
fsb_2:
        pla
        bra make_str

fn_hexs:
        jsr par_num
        jsr getint16
        ldx #0                  ; 16進数の4桁を fbuffr に(先頭の0は除く)
        lda linnum+1
        jsr hex_byte
        lda linnum
        jsr hex_byte
        ldx #0                  ; 先頭の0を飛ばす(最後の1桁は残す)
fh_1:
        cpx #3
        beq fh_2
        lda fbuffr,X
        cmp #'0'
        bne fh_2
        inx
        bra fh_1
fh_2:
        ldy #0                  ; 前へ詰める
fh_3:
        lda fbuffr,X
        sta fbuffr,Y
        iny
        inx
        cpx #4
        bne fh_3
        tya
        bra str_from_buf
hex_byte:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr hex_nib
        pla
        and #$0F
hex_nib:
        cmp #10
        bcc hn_1
        adc #6
hn_1:
        adc #'0'
        sta fbuffr,X
        inx
        rts

fn_val:
        jsr par_str
        tay                     ; 文字列の後ろを一時的に 0 にして数として読む
        bne fv_1                ; (空の文字列は番地が決まっていないことがあるので、書かずに 0)
        stz valtyp
        jmp fac_zero
fv_1:
        lda (strp),Y
        sta str_save
        tya                     ; 0 にする番地を覚える(fin が ?OV などで抜けても、
        clc                     ;  ready と b_warm が val_restore で戻す)
        adc strp
        sta val_ptr
        lda strp+1
        adc #0
        sta val_ptr+1
        lda #0
        sta (strp),Y
        lda txtptr
        pha
        lda txtptr+1
        pha
        lda strp
        sta txtptr
        lda strp+1
        sta txtptr+1
        phy
        jsr fin
        ply
        lda str_save
        sta (strp),Y
        stz val_ptr+1           ; 戻したので、覚えた番地を消す
        pla
        sta txtptr+1
        pla
        sta txtptr
        stz valtyp
        rts

; VAL がエラーなどで途中で抜けたとき、一時的に0にしたバイトを戻す(ready と b_warm から呼ぶ)。
; index1 を壊す
val_restore:
        lda val_ptr+1
        beq vr_done
        sta index1+1
        lda val_ptr
        sta index1
        lda str_save
        sta (index1)
        stz val_ptr+1
vr_done:
        rts

; LEFT$(s$,n) RIGHT$(s$,n) MID$(s$,p[,n])
; 文字列と数を読んで、bt0 = 元の長さ、bt1 = 始め(0から)、bt2 = 長さ にしてから sub_str
fn_lefts:
        jsr par_sn              ; ( s$ , n
        jsr chkclose
        stz bt1
        bra sub_str
fn_rights:
        jsr par_sn
        jsr chkclose
        lda bt2                 ; 始め = 元の長さ - n(負なら 0)
        cmp bt0
        bcc fr_1
        lda bt0
        sta bt2
fr_1:
        sec
        lda bt0
        sbc bt2
        sta bt1
        bra sub_str
fn_mids:
        jsr par_sn              ; ( s$ , p
        lda bt2                 ; p は1以上
        bne fm_1
        jmp err_fc
fm_1:
        dec
        sta bt1
        lda #255
        sta bt2
        jsr chrgot
        cmp #','
        bne fm_2
        jsr chrget
        jsr frmnum
        jsr getbyte
        sta bt2
fm_2:
        jsr chkclose
        ; そのまま sub_str へ

; ARG の位置の一時記述子(par_sn で積んだもの)の文字列の、bt1 から bt2 文字を新しい文字列に
sub_str:
        lda bt1                 ; 始めが長さを超えたら空
        cmp bt0
        bcc ss_1
        stz bt2
        bra ss_2
ss_1:
        sec                     ; 長さ = min(bt2, 元の長さ - 始め)
        lda bt0
        sbc bt1
        cmp bt2
        bcs ss_2
        sta bt2
ss_2:
        lda bt2
        jsr getspa              ; ここで詰め直しが起きても記述子は書き換わる
        lda strp
        sta dest
        lda strp+1
        sta dest+1
        lda sub_lo              ; 元の文字列(記述子から読み直す)
        sta strp2
        lda #>tempst
        sta strp2+1
        ldy #1
        lda (strp2),Y
        clc
        adc bt1
        sta srcp
        iny
        lda (strp2),Y
        adc #0
        sta srcp+1
        ldy bt2
        beq ss_4
ss_3:
        dey
        lda (srcp),Y
        sta (dest),Y
        cpy #0
        bne ss_3
ss_4:
        lda sub_lo              ; 元の一時記述子を捨てる
        ldy #>tempst
        jsr free_ay
        lda bt2
        jmp make_str

; ( 文字列 , 数 を読む。sub_lo = 文字列の一時記述子、bt0 = その長さ、bt2 = 数(0-255)
par_sn:
        jsr chkopen
        jsr frmstr
        lda (fac_m1)
        pha
        lda fac_m1
        pha
        jsr chkcom
        jsr frmnum
        jsr getbyte
        sta bt2
        pla
        sta sub_lo
        pla
        sta bt0
        rts

; INSTR([p,]s$,t$)
fn_instr:
        jsr chkopen
        lda #1
        sta bt3                 ; 探し始める位置(1から)
        jsr frmevl
        lda valtyp
        bne fi_s
        jsr getbyte             ; 最初が数なら位置
        cmp #0
        bne fi_p
        jmp err_fc
fi_p:
        sta bt3
        jsr chkcom
        jsr frmstr
fi_s:
        lda fac_m1              ; s$ の記述子を積む
        pha
        lda fac_m2
        pha
        lda bt3
        pha
        jsr chkcom
        jsr frmstr
        jsr chkclose
        pla
        sta bt3
        pla
        sta strp2+1
        pla
        sta strp2
        ; s$ = index2(本体)、bt0(長さ)。t$ = strp(本体)、bt1(長さ)
        ldy #1
        lda (strp2),Y
        sta index2
        iny
        lda (strp2),Y
        sta index2+1
        lda (strp2)
        sta bt0
        lda strp2
        pha
        lda strp2+1
        pha
        jsr fac_str
        sta bt1
        jsr free_fac
        pla
        tay
        pla
        jsr free_ay
        ; 位置 p から探す
        ldx bt3
        dex                     ; X = 0 から数えた位置
fi_1:
        txa                     ; 残り(長さ - X)が t$ より短ければ見つからない
        clc
        adc bt1
        bcs fi_no
        cmp bt0
        beq fi_2
        bcs fi_no
fi_2:
        ldy #0                  ; X の位置で比べる
fi_3:
        cpy bt1
        beq fi_yes
        sty bt4
        txa
        clc
        adc bt4
        tay
        lda (index2),Y
        ldy bt4
        cmp (strp),Y
        bne fi_next
        iny
        bra fi_3
fi_next:
        inx
        bra fi_1
fi_yes:
        inx                     ; 1から数えた位置
        txa
        stz valtyp
        jmp fac_u8
fi_no:
        lda #0
        stz valtyp
        jmp fac_u8
