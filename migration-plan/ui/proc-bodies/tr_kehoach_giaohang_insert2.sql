-- PARAMS:
-- @maddh nvarchar


CREATE PROC [dbo].[TR_KEHOACH_GIAOHANG_INSERT2](@maddh nvarchar(200))
AS

DECLARE @LOAIDDH NVARCHAR(50)

SELECT @LOAIDDH = loaiddh
FROM tr_dondathang
WHERE maddh = @maddh

IF @LOAIDDH = 'OTHER'
BEGIN
    DECLARE @CNT INT
    SELECT @CNT = COUNT(chitiet)
    FROM tr_dondathang_chitiet
    WHERE maddh = @maddh AND chitiet LIKE 'W%'

    IF @CNT > 0
	   SET @LOAIDDH = 'HTR'
END

IF @LOAIDDH = 'HTR'
BEGIN
    SELECT A.maddh
	  , A.mancc, A.tenncc, A.loaiddh
	  , C.hehang, C.customer
	  , B.masp
	  , B.chitiet, B.tenchitiet, B.soluong
	  , c.cbm * B.soluong AS cbm
	  , B.donhang
	  , a.ngaygiao
    INTO #DONHANG
    FROM tr_dondathang A
	  INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
	  INNER JOIN tr_sanpham C ON C.masp = IIF(LEN(B.masp) > 0, B.masp, dbo.ufn_MaHTR_To_MaSP(B.chitiet))
    WHERE B.chitiet LIKE 'W%'
	  AND A.active = 1
	  AND A.trangthai IN (0, 1, 2)
	  AND A.pheduyet = 1
	  AND A.maddh = @maddh

    DECLARE @HEHANG NVARCHAR(MAX)
    SELECT @HEHANG = COALESCE(@HEHANG + ', ', '') + hehang 
    FROM #DONHANG
    GROUP BY hehang
    ORDER BY hehang

    DECLARE @KHACHHANG NVARCHAR(MAX)
    SELECT @KHACHHANG = COALESCE(@KHACHHANG + ', ', '') + customer 
    FROM #DONHANG
    GROUP BY customer   
    ORDER BY customer

    DECLARE @DONHANG NVARCHAR(MAX)
    SELECT @DONHANG = COALESCE(@DONHANG + ', ', '') + donhang 
    FROM #DONHANG
    GROUP BY donhang   
    ORDER BY donhang
    
    IF EXISTS(SELECT maddh FROM tr_kehoach_giaohang WHERE maddh = @maddh)
    BEGIN
	   DECLARE @M_MADDH NVARCHAR(200)
	   DECLARE @M_NGAYGIAO DATE
	   DECLARE @M_MANCC NVARCHAR(50)
	   DECLARE @M_TENNCC NVARCHAR(200)
	   DECLARE @M_CBM DECIMAL(18, 5)
	   DECLARE @M_CONT DECIMAL(18, 5)
	   DECLARE @M_DONHANG NVARCHAR(MAX)

	   SELECT @M_MADDH = A.maddh
		  , @M_NGAYGIAO = A.ngaygiao
		  , @M_MANCC = A.mancc
		  , @M_TENNCC = A.tenncc
		  , @M_CBM = SUM(A.cbm) 
		  , @M_CONT = SUM(A.cbm) / 68
		  , @M_DONHANG = @DONHANG
	   FROM #DONHANG A
	   GROUP BY A.maddh, A.ngaygiao, A.mancc, A.tenncc, A.donhang	
	   
	   UPDATE tr_kehoach_giaohang
	   SET ngaygiaohang = @M_NGAYGIAO,
		  mancc = @M_MANCC,
		  tenncc = @M_TENNCC,
		  cbm = @M_CBM,
		  soluong_cont = @M_CONT,
		  donhang = @M_DONHANG,
		  hehang = @HEHANG,
		  khachhang = @KHACHHANG
	   WHERE maddh = @maddh
    END
    ELSE
    BEGIN
	   INSERT INTO tr_kehoach_giaohang
	   (
		  maddh, ngaygiaohang, mancc, tenncc, cbm, soluong_cont,
		  batdau, ketthuc, loaiddh, donhang, hehang, khachhang
	   )
	   SELECT A.maddh
		  , A.ngaygiao
		  , A.mancc
		  , A.tenncc
		  , SUM(A.cbm) cbm
		  , SUM(A.cbm) / 68 AS conts
		  , null, null
		  , 'HTR' , @DONHANG
		  , @HEHANG, @KHACHHANG
	   FROM #DONHANG A
	   GROUP BY A.maddh, A.ngaygiao, A.mancc, A.tenncc--, A.donhang
    END

    DROP TABLE #DONHANG
END

