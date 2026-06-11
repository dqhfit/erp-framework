-- PARAMS:
-- @id uniqueidentifier
-- @type int
-- @nguoiduyet nvarchar
-- @ngayduyet datetime

CREATE PROC [dbo].[TR_PHIEUYEUCAU_CONFIRM] (@id           UNIQUEIDENTIFIER,
                                           @type         INT,
                                           @nguoiduyet   NVARCHAR (50),
                                           @ngayduyet    DATETIME)
AS
DECLARE @ALLOWADD   BIT
SELECT @ALLOWADD = AllowAdd
FROM SYS_USER_RULE
WHERE UserName = @nguoiduyet AND C_MENU = 'objDuyetPhieuYeuCau3'

IF @ALLOWADD = 1
   SET @type = 2

DECLARE @loaidexuat   NVARCHAR (50)
SELECT @loaidexuat = loaidexuat
FROM tr_phieuyeucau
WHERE id = @id

DECLARE @ngaydautuan   DATETIME
DECLARE @ngaycuoituan   DATETIME
DECLARE @nguoitao   NVARCHAR (50)
DECLARE @ngaytao   DATETIME
DECLARE @tongsl   FLOAT


IF @Type = 0                                            --TRƯỞNG BỘ PHẬN DUYỆT
   BEGIN
      UPDATE tr_phieuyeucau
      SET nguoiduyet = @nguoiduyet, ngayduyet = @ngayduyet, IsConfirm = 1
      WHERE id = @id
   END
ELSE
   IF @Type = 1                                          --PHÒNG THU MUA DUYỆT
      BEGIN
         UPDATE tr_phieuyeucau
         SET nguoiduyet2 = @nguoiduyet, ngayduyet2 = @ngayduyet
         WHERE id = @id

         IF (@loaidexuat = 'XENANG')
            BEGIN
               IF EXISTS
                     (SELECT id
                      FROM tr_phieuyeucau
                      WHERE     id = @id
                            AND Isnull (nguoiduyet, '') <> ''
                            AND Isnull (nguoiduyet2, '') <> '')
                  BEGIN
                     SELECT @nguoitao = nguoitao, @ngaytao = ngaytao
                     FROM tr_phieuyeucau
                     WHERE id = @id
                     SELECT @ngaydautuan = DATEADD(DAY,2 - DATEPART (WEEKDAY, @ngaytao),CAST (@ngaytao AS DATE))
                     SELECT @ngaycuoituan = DATEADD(DAY,8 - DATEPART (WEEKDAY, @ngaytao),CAST (@ngaytao AS DATE))

                     SELECT @tongsl = SUM (b.soluong)
                     FROM tr_phieuyeucau a
                          JOIN tr_phieuyeucau_chitiet b
                             ON a.id = b.phieuyeucau_id
                     WHERE     a.nguoitao = @nguoitao
                           AND CONVERT (DATE, a.ngaytao) BETWEEN @ngaydautuan AND @ngaycuoituan
                           AND b.mact = 'VDD001-0001'

                     IF (@tongsl <= 60)
                        BEGIN
                           UPDATE tr_phieuyeucau
                           SET nguoiky = 'FRIDAY',
                               ngayky = GETDATE (),
                               IsConfirm = 1
                           WHERE id = @id
                        END
                  END
            END
      END
   ELSE
      IF @Type = 2                                        --BAN GIÁM ĐỐC DUYỆT
         BEGIN
            UPDATE tr_phieuyeucau
            SET nguoiky = @nguoiduyet, ngayky = @ngayduyet, IsConfirm = 1
            WHERE id = @id
         END



		 select * from tr_phieuyeucau where sophieu = '101034'


