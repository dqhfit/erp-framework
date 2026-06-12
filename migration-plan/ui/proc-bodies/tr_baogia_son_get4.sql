-- PARAMS:
-- @MASP nvarchar


CREATE PROC [dbo].[TR_BAOGIA_SON_GET4] (@MASP NVARCHAR (200))
AS
DECLARE @mausac nvarchar(50)
DECLARE @DAI   DECIMAL (18, 0);
DECLARE @RONG   DECIMAL (18, 0);
DECLARE @CAO   DECIMAL (18, 0);
DECLARE @QUYCACH   NVARCHAR (200);

SELECT @mausac = mausac, @QUYCACH = quycach,
       @DAI =
          ISNULL ((SELECT dbo.udf_GetNumeric (value)
                   FROM dbo.fn_Split (REPLACE (quycach, 'x', '*'), '*')
                   WHERE position = 1), 0),
       @RONG =
          ISNULL ((SELECT dbo.udf_GetNumeric (value)
                   FROM dbo.fn_Split (REPLACE (quycach, 'x', '*'), '*')
                   WHERE position = 2), 0),
       @CAO =
          ISNULL ((SELECT dbo.udf_GetNumeric (value)
                   FROM dbo.fn_Split (REPLACE (quycach, 'x', '*'), '*')
                   WHERE position = 3), 0)
FROM tr_sanpham WITH (NOLOCK)
WHERE masp = @MASP;

DECLARE @DONGIA_SON   DECIMAL (18, 3);
--DECLARE @RATE   DECIMAL (18, 3);
--SELECT TOP 1 @RATE = RATE
--FROM tr_baogia_chiphi
--GROUP BY Rate;

--DECLARE @DONGIA_SON double
SELECT @DONGIA_SON = SUM (sl_m2 * dongia)
FROM (SELECT A.mact,
             A.sl_m2,
			 B.dongia
             --dongia = IIF (B.loaitien = N'USD', B.dongia * @RATE, B.dongia)
      FROM tr_dinhmuc_son A WITH (NOLOCK), tr_material B
      WHERE     A.mact = B.mavt
            AND B.xoa = 'N'
            AND masp = @MASP
            AND hoanthanh = 1) A

IF @DONGIA_SON IS NULL
	SET @DONGIA_SON = 0

IF @DONGIA_SON <= 0
BEGIN
	SELECT @DONGIA_SON = SUM(A.soluong * ISNULL(A.dongia, B.dongia))
	FROM tr_dinhmuc_son_theomau A
		INNER JOIN tr_material B ON A.mact = B.mavt
	WHERE mamau = @mausac
END

DECLARE @MATSON TABLE
(
	STT       INT,
	CUMSON    NVARCHAR(200),
	CUM       NVARCHAR (200),
	CODE      NVARCHAR (20),
	[NAME]    NVARCHAR (200)
);

INSERT INTO @MATSON (STT, CUMSON, CUM, CODE, NAME)
VALUES (1,'dinh',N'Đình','dinh_matngoai',N'Mặt ngoài'),
       (2,'dinh',N'Đình','dinh_mattrong',N'Mặt trong'),
       (3,'hongtrai',N'Hông trái','hongtrai_matngoai',N'Mặt ngoài'),
       (4,'hongtrai',N'Hông trái','hongtrai_mattrong',N'Mặt trong'),
	  (5,'hongphai',N'Hông phải','hongphai_matngoai',N'Mặt ngoài'),
       (6,'hongphai',N'Hông phải','hongphai_mattrong',N'Mặt trong'),
       (7,'day',N'Đáy','day_matngoai',N'Mặt ngoài'),
       (8,'day',N'Đáy','day_mattrong',N'Mặt trong'),
       (9,'mattruoc',N'Mặt trước','truoc_matngoai',N'Mặt ngoài'),
       (10,'mattruoc',N'Mặt trước','truoc_mattrong',N'Mặt trong'),
	  (11,'matsau',N'Mặt sau','sau_matngoai',N'Mặt ngoài'),
       (12,'matsau',N'Mặt sau','sau_mattrong',N'Mặt trong')

SELECT masp = @MASP,
	  A.CUMSON,
	  CUM,
       CODE,
       [NAME],
       quycach =
          CASE
             WHEN CODE = 'dinh_matngoai' THEN CONCAT (@DAI, '*', @RONG)
             WHEN CODE = 'dinh_mattrong' THEN CONCAT (@DAI, '*', @RONG)
             WHEN CODE = 'day_matngoai' THEN CONCAT (@DAI, '*', @RONG)
		   WHEN CODE = 'day_mattrong' THEN CONCAT (@DAI, '*', @RONG)
		   WHEN CODE = 'hongtrai_matngoai' THEN CONCAT (@RONG, '*', @CAO)
             WHEN CODE = 'hongtrai_mattrong' THEN CONCAT (@RONG, '*', @CAO)
		   WHEN CODE = 'hongphai_matngoai' THEN CONCAT (@RONG, '*', @CAO)
             WHEN CODE = 'hongphai_mattrong' THEN CONCAT (@RONG, '*', @CAO)
		   WHEN CODE = 'truoc_matngoai' THEN CONCAT (@CAO, '*', @DAI)
		   WHEN CODE = 'truoc_mattrong' THEN CONCAT (@CAO, '*', @DAI)
		   WHEN CODE = 'sau_matngoai' THEN CONCAT (@CAO, '*', @DAI)
		   WHEN CODE = 'sau_mattrong' THEN CONCAT (@CAO, '*', @DAI)
          END,
       dai = @DAI,
       rong = @RONG,
       cao = @CAO,
       dientich =
		CASE
             WHEN CODE = 'dinh_matngoai' THEN  (@DAI*@RONG)/ 1000000
             WHEN CODE = 'dinh_mattrong' THEN  (@DAI*@RONG)/ 1000000
             WHEN CODE = 'day_matngoai' THEN  (@DAI*@RONG)/ 1000000
		   WHEN CODE = 'day_mattrong' THEN  (@DAI*@RONG)/ 1000000
		   WHEN CODE = 'hongtrai_matngoai' THEN  (@RONG*@CAO)/ 1000000
             WHEN CODE = 'hongtrai_mattrong' THEN  (@RONG*@CAO)/ 1000000
		   WHEN CODE = 'hongphai_matngoai' THEN  (@RONG*@CAO)/ 1000000
             WHEN CODE = 'hongphai_mattrong' THEN  (@RONG*@CAO)/ 1000000
		   WHEN CODE = 'truoc_matngoai' THEN  (@CAO*@DAI)/ 1000000
		   WHEN CODE = 'truoc_mattrong' THEN  (@CAO*@DAI)/ 1000000
		   WHEN CODE = 'sau_matngoai' THEN  (@CAO*@DAI)/ 1000000
		   WHEN CODE = 'sau_mattrong' THEN  (@CAO*@DAI)/ 1000000
          END,
          
       ISNULL (B.phantram_son, 100) AS phantram_son,
       dongia = isnull(@DONGIA_SON,b.dongia)
	   into #temp
FROM @MATSON A
     LEFT JOIN tr_baogia_son B ON A.CODE = B.matson AND A.CUMSON = B.cumson AND B.masp = @MASP and baoGiaID is null
ORDER BY STT

select a.masp,a.CUMSON,a.CUM,a.CODE,a.[NAME],a.quycach,a.dai,a.rong,a.cao,
	a.dientich,a.phantram_son,
	ISNULL(a.dongia,c.dongia) as dongia
from #temp a
join tr_sanpham b on a.masp = b.masp
left join tr_color c on b.mausac = c.code

drop table #temp





