CREATE   FUNCTION [dbo].[FN_DONGIA_NGUYENLIEU_GVA4]
(
    @id_nguyenlieu nvarchar(200),
    @dayy decimal(18, 5),
    @dai decimal(18, 5)
)
RETURNS TABLE
AS
RETURN
(
    WITH PriceData AS (
        SELECT dongia, loaitien,
               CASE 
                   WHEN @dai > (SELECT MAX(dai_den) 
                               FROM tr_dongia_nguyenlieu_gva 
                               WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu) 
                               AND dayy = @dayy) THEN
                       -- Trường hợp @dai lớn hơn max length
                       CASE WHEN dongia = (
                           SELECT TOP 1 IIF(ISNULL(gianhap, 0) = 0, dongia, gianhap)
                           FROM tr_dongia_nguyenlieu_gva
                           WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
                           AND dayy = @dayy
                           ORDER BY dai_den DESC
                       ) THEN 1 ELSE 0 END
                   WHEN EXISTS (
                       SELECT 1 
                       FROM tr_dongia_nguyenlieu_gva
                       WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
                       AND dayy = @dayy
                       AND (@dai >= dai_tu AND @dai < dai_den)
                   ) THEN
                       -- Trường hợp tìm thấy khoảng dai_tu và dai_den phù hợp
                       CASE WHEN @dai >= dai_tu AND @dai < dai_den THEN 1 ELSE 0 END
                   ELSE
                       -- Trường hợp không tìm thấy giá phù hợp, lấy giá cao nhất
                       CASE WHEN dongia = (
                           SELECT TOP 1 IIF(ISNULL(gianhap, 0) = 0, dongia, gianhap)
                           FROM tr_dongia_nguyenlieu_gva
                           WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
                           ORDER BY dongia DESC
                       ) THEN 1 ELSE 0 END
               END as IsMatch
        FROM tr_dongia_nguyenlieu_gva
        WHERE (id_nguyenlieu = @id_nguyenlieu OR nguyenlieu = @id_nguyenlieu)
    )
    SELECT TOP 1 dongia, loaitien
    FROM PriceData
    WHERE IsMatch = 1
)
