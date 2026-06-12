-- PARAMS:
-- @MADDH nvarchar


CREATE PROC [dbo].[DQT_DINHMUC_GOVAN_GET2]
( 
	@MADDH nvarchar(max)
)
AS
BEGIN
    --DECLARE @MADDH NVARCHAR(MAX) = 'DQH-DQHF09/1219';
    DECLARE @ATTRIBUTE1 nvarchar(200);
    DECLARE @ATTRIBUTE3 nvarchar(200);
    DECLARE @MACT nvarchar(200);
    DECLARE @SOLUONG decimal(18, 3);

    DECLARE @TBL_DINHMUC TABLE
    ( 
	    id              int, 
	    maddh           nvarchar(max), 
	    masp            nvarchar(max), 
	    mahtr           nvarchar(max), 
	    mact            nvarchar(max), 
	    stt             nvarchar(50), 
	    chitiet         nvarchar(max), 
	    nguyenlieu      nvarchar(max), 
	    dayy_tc         decimal(18, 3), 
	    rong_tc         decimal(18, 3), 
	    dai_tc          decimal(18, 3), 
	    soluong_tc      decimal(18, 3), 
	    soluong_donhang decimal(18, 3), 
	    m3_tc           decimal(18, 5), 
	    dayy_phoi       decimal(18, 3), 
	    ghichu          nvarchar(max), 
	    quytrinhgiacong nvarchar(max)
    )

    DECLARE m_Cursor CURSOR
    FOR SELECT 
			SUBSTRING(A.chitiet, 2, CHARINDEX('_', A.chitiet) - 2) AS attribute1
		   , RIGHT(A.chitiet, 2) AS attribute3
		   , A.chitiet
		   , SUM(A.soluong) AS soluong
	   FROM   tr_dondathang_chitiet AS A
	   WHERE  ( maddh LIKE 'DQT%'
			  OR maddh LIKE 'DQH%' )
			AND active = 1
			AND chitiet LIKE 'W%'
			AND maddh LIKE @MADDH
	   GROUP BY 
			  A.chitiet
			, RIGHT(A.chitiet, 2)
			, SUBSTRING(A.chitiet, 2, CHARINDEX('_', A.chitiet))
	   ORDER BY 
			  A.chitiet
    OPEN m_Cursor
    FETCH NEXT FROM m_Cursor INTO @ATTRIBUTE1, @ATTRIBUTE3, @MACT, @SOLUONG
    WHILE @@FETCH_STATUS = 0
    BEGIN
	   DECLARE @MASP nvarchar(max);

	   --SELECT TOP 1 @MASP = masp
	   --FROM   tr_chitiet_hangtrang WITH(NOLOCK)
	   --WHERE  attribute1 = @ATTRIBUTE1 AND attribute3 = @ATTRIBUTE3;

	   SELECT @MASP = dbo.ufn_MaHTR_To_MaSP(@MACT)

	   IF @MASP IS NOT NULL OR @MASP != ''
	   BEGIN
		  INSERT INTO @TBL_DINHMUC
		  ( 
			    id
			  , maddh
			  , masp
			  , mahtr
			  , mact
			  , stt
			  , chitiet
			  , nguyenlieu
			  , dayy_tc
			  , rong_tc
			  , dai_tc
			  , soluong_tc
			  , soluong_donhang
			  , m3_tc
			  , dayy_phoi
			  , ghichu
			  , quytrinhgiacong
		  )
		  SELECT 
			    id
			  , @MADDH
			  , masp
			  , @MACT
			  , mact
			  , stt
			  , chitiet
			  , nguyenlieu
			  , dayy_tc
			  , rong_tc
			  , dai_tc
			  , soluong_tc
			  , (CAST(soluong_tc AS float) * @SOLUONG) AS soluong_donhang
			  , (m3_tc * @SOLUONG) AS m3_tc
			  , dayy_phoi
			  , ghichu
			  , quytrinhgiacong
		  FROM   tr_dinhmuc_govan WITH(NOLOCK)
		  WHERE  hoanthanh = 1
			    AND masp = @MASP
			    AND ISNULL(mact, '') <> '000'
		  --ORDER BY stt
	   END

	   FETCH NEXT FROM m_Cursor INTO @ATTRIBUTE1, @ATTRIBUTE3, @MACT, @SOLUONG
    END
    CLOSE m_Cursor
    DEALLOCATE m_Cursor

    SELECT *
    FROM   @TBL_DINHMUC
    ORDER BY maddh
		 , masp
		 , mahtr
		 , stt
END
