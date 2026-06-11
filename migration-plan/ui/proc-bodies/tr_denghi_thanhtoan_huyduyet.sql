-- PARAMS:
-- @id uniqueidentifier
-- @type int
-- @lydo nvarchar

CREATE PROC [dbo].[TR_DENGHI_THANHTOAN_HUYDUYET]
(
	@id uniqueidentifier, 
	@type int,
	@lydo nvarchar(500)
)
AS
BEGIN
    IF @type = 0 --trưởng bộ phận
    BEGIN
    	UPDATE tr_denghi_thanhtoan
    	SET truongbophan = NULL,
    		ngayduyet2 = NULL,
    		ngayhuyduyet = GETDATE(),
    		lydohuyduyet = @lydo,
    		active = 0
    	WHERE id = @id
    END
    ELSE IF @type = 1 --BAN GIÁM ĐỐC
    BEGIN
    	UPDATE tr_denghi_thanhtoan
    	SET nguoiduyet = NULL,
    		ngayduyet = NULL,
    		ngayhuyduyet = GETDATE(),
    		lydohuyduyet = @lydo,
    		active = 0
    	WHERE id = @id
    END

    /* loaithanhtoan (1. Tạm ứng, 2. Thanh toán)  */
    DECLARE @loaithanhtoan int;
    DECLARE @chungtu nvarchar(200);
    DECLARE @sotien DECIMAL(18, 3);

    SELECT @loaithanhtoan = loaithanhtoan, 
        @chungtu = ISNULL(chungtu, ''), 
        @sotien = sotien 
    FROM tr_denghi_thanhtoan
    WHERE id = @id

    IF LEN(@chungtu) > 0
    BEGIN
        IF @loaithanhtoan = 1
        BEGIN
            UPDATE tr_dondathang
            SET tientamung = tientamung - @sotien,
                isPayment = 0
            WHERE maddh = @chungtu
        END
        ELSE IF @loaithanhtoan = 2
        BEGIN
            UPDATE tr_dondathang
            SET tienthanhtoan = tienthanhtoan - @sotien,
                isPayment = 0
            WHERE maddh = @chungtu
        END
    END

END
