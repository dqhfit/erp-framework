-- PARAMS:
-- @DONHANG nvarchar



CREATE PROC TR_BAOCAO_TONGHOPCHITIET_BYDONHANG(@DONHANG NVARCHAR(4000))
AS
SELECT chitiet, nguyenlieu
    , dayy_tc, rong_tc, dai_tc
    , mausac
    , SUM(soluong_tc) soluong_tc
    , SUM(m3_tc) m3_tc
    , SUM(m2_tc) m2_tc
FROM (
SELECT B.chitiet, B.nguyenlieu
    , B.dayy_tc, B.rong_tc, B.dai_tc 
    , soluong_tc = (B.soluong_tc * A.order_qty)
    , m3_tc = (B.dayy_tc * B.rong_tc * B.dai_tc * B.soluong_tc * A.order_qty) / 1000000000
    , m2_tc = (B.rong_tc * B.dai_tc * B.soluong_tc * A.order_qty) / 1000000
    , C.mausac
FROM tr_order_detail A
    INNER JOIN tr_dinhmuc_govan B ON A.item_number = B.masp
    INNER JOIN tr_sanpham C ON A.item_number = C.masp
WHERE A.f_cancelled = 'N'
    AND A.order_number IN (SELECT LTRIM(RTRIM([VALUE])) FROM dbo.fn_Split(@DONHANG, ','))
    AND B.nguyenlieu NOT IN ('', '0')
) A
GROUP BY chitiet, nguyenlieu, dayy_tc, rong_tc, dai_tc, mausac




