
CREATE FUNCTION [dbo].[ufn_MaHTR_To_MaSP]
( 
	@MaHTR nvarchar(200)
)
RETURNS nvarchar(200)
AS
BEGIN

    DECLARE @MaSP nvarchar(200);
    DECLARE @RESULT nvarchar(200);

    DECLARE m_Cursor CURSOR
    FOR SELECT masp
	   FROM   tr_chitiet_hangtrang WITH(NOLOCK)
	   WHERE  mact = @MaHTR
    OPEN m_Cursor
    FETCH NEXT FROM m_Cursor INTO @MaSP
    WHILE @@FETCH_STATUS = 0
    BEGIN
	   IF EXISTS (SELECT 1 FROM tr_dinhmuc_govan WITH(NOLOCK) WHERE masp = @MaSP)
	   BEGIN
		  SET @RESULT = @MaSP
		  BREAK
	   END

	   FETCH NEXT FROM m_Cursor INTO @MaSP
    END
    CLOSE m_Cursor
    DEALLOCATE m_Cursor

    RETURN @RESULT
END

