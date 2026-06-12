-- PARAMS:
-- @congdoan nvarchar

CREATE   PROCEDURE [dbo].[TR_TRANGTHAI_SANXUAT_GETLIST4](@congdoan nvarchar(50))
AS
BEGIN
    SELECT A.maddh
    INTO #DONDATHANG
    FROM tr_dondathang A
        INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
    WHERE A.trangthai  IN ('0', '1', '2') AND A.active = 1
        AND B.chitiet LIKE 'W%'
    GROUP BY A.maddh

    SELECT A.dondathang, A.masp, A.mahtr, A.stt, A.mact, A.tenct, A.nguyenlieu, 
        A.dayy_tc, A.rong_tc, A.dai_tc,
        SUM(A.soluong_tc * A.soluong_donhang) AS soluong_tc,
        SUM(A.sokhoi_tinhche) AS sokhoi_tinhche
    INTO #PHIEUPALLET
    FROM tr_pallet A
    WHERE A.dondathang IN (SELECT maddh FROM #DONDATHANG)
        AND A.active = 1 --AND A.nguyenlieu NOT IN ('', '0')
		AND A.isCreateCard = 1
    GROUP BY A.dondathang, A.masp, A.mahtr, A.stt, A.mact, A.tenct, A.nguyenlieu, A.dayy_tc, A.rong_tc, A.dai_tc

    SELECT A.madonhang, A.masp, A.masp1, A.mact, A.tenct, A.congdoan,
        SUM(A.soluong) as soluong_hoanthanh, 
        SUM(A.sokhoi) as sokhoi_hoanthanh
    INTO #TRANGTHAI_SANXUAT
    FROM tr_trangthai_sanxuat A
    WHERE A.madonhang IN (SELECT maddh FROM #DONDATHANG) AND A.congdoan = @congdoan
    GROUP BY A.madonhang, A.masp, A.masp1, A.mact, A.tenct, A.congdoan

    SELECT B.congdoan, A.dondathang, A.masp, A.mahtr, A.stt, A.mact, A.tenct, A.nguyenlieu, 
        A.dayy_tc, A.rong_tc, A.dai_tc,
        A.soluong_tc as soluong_can, 
        A.sokhoi_tinhche as sokhoi_can,

		ISNULL(B.soluong_hoanthanh, 0) AS soluong_hoanthanh,
		ISNULL(B.sokhoi_hoanthanh, 0) AS sokhoi_hoanthanh

        --IIF(B.soluong_hoanthanh > A.soluong_tc, A.soluong_tc, ISNULL(B.soluong_hoanthanh, 0)) AS soluong_hoanthanh, 
        --IIF(B.sokhoi_hoanthanh > A.sokhoi_tinhche, A.sokhoi_tinhche, ISNULL(B.sokhoi_hoanthanh, 0)) AS sokhoi_hoanthanh
    FROM #PHIEUPALLET A
        LEFT JOIN #TRANGTHAI_SANXUAT B ON A.dondathang = B.madonhang AND A.mact = B.mact AND A.mahtr = B.masp
    
    DROP TABLE #DONDATHANG, #PHIEUPALLET, #TRANGTHAI_SANXUAT
END



