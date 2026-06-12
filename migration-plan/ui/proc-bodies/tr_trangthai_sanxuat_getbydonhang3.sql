-- PARAMS:
-- @madonhang nvarchar
-- @congdoan nvarchar

CREATE   PROCEDURE [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG3]
(
    @madonhang nvarchar(200),
    @congdoan nvarchar(50)
)
AS
BEGIN
--    DECLARE @madonhang nvarchar(200);
--    DECLARE @congdoan nvarchar(50);
--
--    SET @madonhang = 'DQH-VFM02/0524'
--    SET @congdoan = 'DH02-PROD'

    SELECT A.dondathang, A.masp, A.mahtr, A.stt, A.mact, A.tenct, A.nguyenlieu, 
        A.dayy_tc, A.rong_tc, A.dai_tc, A.soluong_tc, A.soluong_donhang, 
        B.card_no, B.soluong AS soluong_can
    INTO #PALLET_CARD
    FROM tr_pallet A
        INNER JOIN tr_pallet_card B ON A.id = B.pallet_id
    WHERE A.dondathang = @madonhang 
        AND A.active = 1
        AND B.active = 1

    SELECT pcard, SUM(soluong) AS soluong_hoanthanh
    INTO #TRANGTHAI_SANXUAT
    FROM tr_trangthai_sanxuat
    WHERE pcard IS NOT NULL
        AND madonhang = @madonhang
        AND congdoan = @congdoan
    GROUP BY pcard


    SELECT A.*, B.soluong_hoanthanh, 
        IIF(A.soluong_can - ISNULL(B.soluong_hoanthanh, 0) < 0, 0, A.soluong_can - ISNULL(B.soluong_hoanthanh, 0)) as soluong_conlai, 
        NULL as soluong_nhap
    FROM #PALLET_CARD A
        LEFT JOIN #TRANGTHAI_SANXUAT B ON A.card_no = B.pcard
    ORDER BY A.dondathang, A.masp, A.stt

    DROP TABLE #PALLET_CARD, #TRANGTHAI_SANXUAT

END
