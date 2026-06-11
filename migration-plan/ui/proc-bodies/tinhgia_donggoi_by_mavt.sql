-- PARAMS:
-- @dongia_vattu int OUTPUT
-- @mavt nvarchar
-- @mancc nvarchar

CREATE   PROCEDURE [dbo].[TINHGIA_DONGGOI_BY_MAVT]
(
    @dongia_vattu int OUT,
    @mavt nvarchar(200),
	@mancc nvarchar(500) = NULL
)
AS
BEGIN
    --DECLARE @mavt nvarchar(200) = 'CEP001-1260'
    DECLARE @seq10 nvarchar(max)
    DECLARE @seg8 nvarchar(50)

    SELECT @seq10 = seq10, @seg8 = seg8
    FROM tr_material
    WHERE mavt = @mavt
    
    DECLARE @quycach nvarchar(MAX);
    DECLARE @dai float = 0, @rong float = 0, @cao float = 0;
    DECLARE @rong1 float = 0, @cao1 float = 0;
    DECLARE @dinhluong float = 0, @dobuc float = 0, @solop float = 0;
    DECLARE @dongia float = 0;
	DECLARE @phi float; -- cập nhật ngày 2025.07.25

    DECLARE @id int;
    DECLARE @ten nvarchar(200);
    DECLARE @giatri nvarchar(50);

    DECLARE CUR CURSOR LOCAL FOR
        SELECT a.id, a.[name], b.[value]
        FROM trmaterialclassstddtail b
            INNER JOIN trmaterialclassstd a ON a.id = b.idstd
        WHERE b.id in (SELECT RTRIM(LTRIM([value])) FROM dbo.fn_Split(@seq10, ','))
    OPEN CUR

    FETCH NEXT FROM CUR INTO @id, @ten, @giatri
    WHILE @@FETCH_STATUS = 0
    BEGIN
		IF @seg8 = 'CEP002'
        BEGIN
            DECLARE @hasLeftParen BIT = 0;
            DECLARE @hasRightParen BIT = 0;
            
            IF @id = 22 SET @dinhluong = CAST(dbo.fn_getNumber(@giatri) AS float);
            IF @id = 4 SET @dai = CAST(dbo.fn_getNumber(@giatri) AS float);
            IF @id = 3
            BEGIN
                SET @hasLeftParen = CASE WHEN CHARINDEX('(', @giatri) > 0 THEN 1 ELSE 0 END;
                SET @hasRightParen = CASE WHEN CHARINDEX(')', @giatri) > 0 THEN 1 ELSE 0 END;
                
                SET @rong = CAST( CASE WHEN @hasLeftParen = 1 THEN LEFT(@giatri, CHARINDEX('(', @giatri) - 1) ELSE @giatri END AS float);
                SET @rong1 = CAST(CASE WHEN @hasLeftParen = 1 AND @hasRightParen = 1 THEN SUBSTRING(@giatri, CHARINDEX('(', @giatri) + 1, CHARINDEX(')', @giatri) - CHARINDEX('(', @giatri) - 1) ELSE '0' END AS FLOAT);
            END
            IF @id = 9
            BEGIN
                SET @hasLeftParen = CASE WHEN CHARINDEX('(', @giatri) > 0 THEN 1 ELSE 0 END;
                SET @hasRightParen = CASE WHEN CHARINDEX(')', @giatri) > 0 THEN 1 ELSE 0 END;
                
                SET @cao = CAST( CASE WHEN @hasLeftParen = 1 THEN LEFT(@giatri, CHARINDEX('(', @giatri) - 1) ELSE @giatri END AS float);
                SET @cao1 = CAST(CASE WHEN @hasLeftParen = 1 AND @hasRightParen = 1 THEN SUBSTRING(@giatri, CHARINDEX('(', @giatri) + 1, CHARINDEX(')', @giatri) - CHARINDEX('(', @giatri) - 1) ELSE '0' END AS FLOAT);
            END
        END
        ELSE
        BEGIN
            IF @id = 17
			BEGIN
				SELECT position, LTRIM(RTRIM([value])) AS Part
				INTO #Parts
				FROM dbo.fn_Split(@giatri, '*');

				SELECT 
				   @dai = MIN(CASE WHEN position = 1 AND ISNUMERIC(Part) = 1 THEN Part END),
				   @rong = MIN(CASE WHEN position = 2 AND ISNUMERIC(Part) = 1 THEN Part END),
				   @cao = MIN(CASE WHEN position = 3 AND ISNUMERIC(Part) = 1 THEN Part END)
				FROM #Parts
				DROP TABLE #Parts
			END
			ELSE
			BEGIN
				SET @giatri = dbo.fn_getNumber(@giatri);
				IF ISNUMERIC(@giatri) = 1
				BEGIN
					IF @id = 3 SET @rong = CAST(@giatri AS float);
					IF @id = 4 SET @dai = CAST(@giatri AS float);
					IF @id = 5 SET @dinhluong = CAST(@giatri AS float);
					IF @id = 9 SET @cao = CAST(@giatri AS float);
					IF @id = 14 SET @phi = CAST(@giatri AS float);
					IF @id = 18 SET @dobuc = CAST(@giatri AS float);
					IF @id = 19 SET @solop = CAST(@giatri AS float);
					IF @id = 22 SET @dinhluong = CAST(@giatri AS float);
				END
			END
            
        END 
        
        FETCH NEXT FROM CUR INTO @id, @ten, @giatri
    END
    CLOSE CUR
    DEALLOCATE CUR

	DECLARE @chuvi float = 0;
	DECLARE @metvuong float = 0;

    IF @seg8 = 'CEP001'
    BEGIN
        -- XỐP TẤM
        SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8 AND dinhluong = @dinhluong
        
        SET @dongia_vattu = ((@dai*@rong*@cao)/1000000000)*@dongia;
    END
    ELSE IF @seg8 = 'CEP002'
    BEGIN
        -- XỐP L
        SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8 AND dinhluong = @dinhluong
        
        SET @dongia_vattu = (@dai * (@rong*@rong1+(@cao-@rong1)*@cao1))/1000000000 * @dongia;
    END
    ELSE IF @seg8 = 'CEP005'
    BEGIN
        -- XỐP TAM GIÁC
        SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8 AND dinhluong = @dinhluong
        
        SET @dongia_vattu = (((@dai*@rong*@cao)/1000000000)*@dongia)/2;
    END
	ELSE IF @seg8 = 'CCT003'
	BEGIN
		-- THÙNG A1
		SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8

		SET @chuvi = (@dai + @rong)*2;
		IF @chuvi < 2500
			SET @metvuong = (@dai*2+@rong*2+40)*(@rong+@cao+20)/1000000;
		ELSE
			SET @metvuong = (@dai*2+@rong*2+80)*(@rong+@cao+20)/1000000;
		SET @dongia_vattu = @dongia * @metvuong;
	END
	ELSE IF @seg8 = 'CCT007'
	BEGIN
		-- THÙNG A5
		SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8

		SET @chuvi = (@dai + @rong)*2;
		IF @chuvi < 2500
			SET @metvuong = (2*@rong+2*@cao+40)*(@dai+2*@cao+20)/1000000;
		ELSE
			SET @metvuong = (2*@rong+2*@cao+80)*(@dai+2*@cao+20)/1000000;
		SET @dongia_vattu = @dongia * @metvuong;
	END
	ELSE IF @seg8 IN ('CCT008', 'CCT010', 'CCT011')
	BEGIN
		-- THÙNG ÂM DƯƠNG
		SELECT @dongia = dongia FROM tr_congthuc_donggoi
        WHERE nhom_chitiet = @seg8

		SET @metvuong =(@dai+2*@cao+20)*(@rong+2*@cao+20)/1000000;
		SET @dongia_vattu = @dongia * @metvuong;
	END
	ELSE IF @seg8 = 'CCT015'
	BEGIN
		SELECT TOP (1) @dongia = dongia 
		FROM tr_congthuc_donggoi
		WHERE nhom_chitiet = @seg8 AND qc_phi >= @phi AND qc_dayy >= @cao AND mancc = @mancc
		ORDER BY qc_phi, qc_dayy

		IF @dongia IS NULL OR @dongia = 0
		BEGIN
			SELECT TOP (1) @dongia = dongia 
			FROM tr_congthuc_donggoi
			WHERE nhom_chitiet = @seg8 AND qc_phi >= @phi AND qc_dayy >= @cao
			ORDER BY qc_phi, qc_dayy, dongia
		END

		SET @metvuong = (@dai * @rong)/1000000;
		SET @dongia_vattu = ROUND(@dongia * @metvuong, 0);
	END
END

