; PX-65 テスト用ROM
;
; 画面に枠、文字「PX-65」、三角波を描き、タイマー割り込みでカーソルを0.5秒ごとに点滅させる。
; 押されているキーを左端の8×8ドットに表示し、キーを押すとビープを鳴らす。
;
;   node tools/asm.js rom/test_pattern.s -o rom/test_pattern.bin --range C000:FFFF

; ---- I/O ----
KEY_ROW    = $8000
KEY_COL    = $8001
LCD_ANN    = $8002
LCD_CTRL   = $8003
TIMER_CTRL = $8010
BEEP       = $8020

VRAM       = $0400          ; 96バイト × 4ページ
PAGE1      = VRAM+96
PAGE2      = VRAM+192
PAGE3      = VRAM+288

; ---- ゼロページ ----
ticks      = $00            ; タイマー割り込みの回数(64Hz)
ptr        = $02            ; 2バイト
px         = $04
py         = $05
dir        = $06
tmp        = $07
anykey     = $08            ; 今回押されていたキー(全行のOR)
prevkey    = $09            ; 前回の anykey

        .org $C000

; ===== リセット =====
reset:
        sei
        cld
        ldx #$FF
        txs
        lda #$81                ; 表示オン、コントラスト8
        sta LCD_CTRL

; ---- 枠: 上下の線 ----
        ldx #0
frame_h:
        lda #$01                ; 一番上のドット
        sta VRAM,X
        lda #$80                ; 一番下のドット
        sta PAGE3,X
        inx
        cpx #96
        bne frame_h

; ---- 枠: 左右の線 ----
        lda #$FF
        sta VRAM
        sta PAGE1
        sta PAGE2
        sta PAGE3
        sta VRAM+95
        sta PAGE1+95
        sta PAGE2+95
        sta PAGE3+95

; ---- 文字「PX-65」(ページ1の中央) ----
        ldx #0
logo_loop:
        lda logo,X
        sta PAGE1+33,X
        inx
        cpx #30
        bne logo_loop

; ---- 三角波(y=17〜30) ----
        lda #30
        sta py
        lda #$FF                ; 上向き(-1)から始める
        sta dir
        lda #1
        sta px
wave_loop:
        ldx px
        ldy py
        jsr plot
        lda py
        clc
        adc dir
        sta py
        cmp #17
        beq wave_flip
        cmp #30
        bne wave_next
wave_flip:
        lda dir
        eor #$FE                ; $FF(-1) と $01(+1) を入れ替える
        sta dir
wave_next:
        inc px
        lda px
        cmp #95
        bne wave_loop

; ---- タイマー割り込みを有効にして待つ ----
        lda #$81                ; IRQ有効、要求をクリア
        sta TIMER_CTRL
        cli
main:
        wai
        jsr scan_keys
        lda ticks
        and #$1F                ; 32回(0.5秒)に1回
        bne main
        ldx #4                  ; カーソル(5×7ドット)を反転
cursor_loop:
        lda PAGE1+84,X
        eor #$7F
        sta PAGE1+84,X
        dex
        bpl cursor_loop
        bra main

; ===== キーボードを読む =====
; 8行を順に読み、押されているキーを左端の8×8ドットに表示する(1列が1行ぶん)。
; 何も押されていない状態から押されたら短くビープを鳴らす。SHIFTが押されていたらSHIFT表示を点ける。
scan_keys:
        stz anykey
        ldx #0
sk_loop:
        lda row_select,X
        sta KEY_ROW
        lda KEY_COL
        eor #$FF                ; 押されている列を1にする
        sta PAGE1+4,X
        ora anykey
        sta anykey
        inx
        cpx #8
        bne sk_loop

        lda PAGE1+4+3           ; 行3の列4がSHIFT
        and #$10
        beq sk_noshift
        lda #$02                ; SHIFT表示
sk_noshift:
        sta LCD_ANN

        lda anykey
        beq sk_save             ; 何も押されていない
        lda prevkey
        bne sk_held             ; 押しっぱなし
        jsr play_beep
sk_held:
        lda anykey
sk_save:
        sta prevkey
        rts

; ===== ビープ(約2kHz、約0.1秒) =====
; 鳴らしている間はBUSY表示を点ける
play_beep:
        lda LCD_ANN
        ora #$01
        sta LCD_ANN
        ldy #200
play_beep_loop:
        lda #1
        sta BEEP
        jsr delay
        stz BEEP
        jsr delay
        dey
        bne play_beep_loop
        lda LCD_ANN
        and #$FE
        sta LCD_ANN
        rts

; 約250サイクル待つ(Xを壊す)
delay:
        ldx #48
delay_loop:
        dex
        bne delay_loop
        rts

; ===== ドットを点灯する =====
; 入力: X = x座標(0〜95)、Y = y座標(0〜31)
; 壊すレジスタ: A, Y
plot:
        phx
        tya
        and #7
        sta tmp                 ; ページ内のビット番号
        tya
        lsr
        lsr
        lsr
        tay                     ; ページ番号
        txa
        clc
        adc page_lo,Y
        sta ptr
        lda page_hi,Y
        adc #0
        sta ptr+1
        ldy tmp
        lda bitmask,Y
        ora (ptr)
        sta (ptr)
        plx
        rts

; ===== 割り込み =====
irq:
        pha
        lda #$81                ; 要求をクリア(IRQは有効のまま)
        sta TIMER_CTRL
        inc ticks
        pla
        rti

nmi:
        rti

; ===== データ =====
page_lo:  .byte <VRAM, <PAGE1, <PAGE2, <PAGE3
page_hi:  .byte >VRAM, >PAGE1, >PAGE2, >PAGE3
bitmask:  .byte $01, $02, $04, $08, $10, $20, $40, $80
row_select: .byte $FE, $FD, $FB, $F7, $EF, $DF, $BF, $7F

; 5×7フォント(1バイト = 縦1列、bit0が上)+ 1列の空白
logo:
        .byte $7F, $09, $09, $09, $06, $00   ; P
        .byte $63, $14, $08, $14, $63, $00   ; X
        .byte $08, $08, $08, $08, $08, $00   ; -
        .byte $3C, $4A, $49, $49, $30, $00   ; 6
        .byte $27, $45, $45, $45, $39, $00   ; 5

; ===== ベクタ =====
        .org $FFFA
        .word nmi, reset, irq
