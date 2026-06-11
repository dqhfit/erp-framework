-- PARAMS:
-- @id uniqueidentifier
-- @type int
-- @nguoiduyet nvarchar
-- @ngayduyet datetime

CREATE PROC TR_DEXUAT_BANGMAU_CONFIRM
(
  @id uniqueidentifier,
  @type int,
  @nguoiduyet nvarchar(50),
  @ngayduyet datetime
)
AS
IF @type = 1 -- TRƯỞNG BỘ PHẬN
BEGIN
  UPDATE tr_dexuat_bangmau
  SET truongbophan_duyet = @nguoiduyet,
      truongbophan_ngayduyet = @ngayduyet
  WHERE id = @id
END
ELSE IF @type = 2 -- BAN GIÁM ĐỐC
BEGIN
  UPDATE tr_dexuat_bangmau
  SET bangiamdoc_duyet = @nguoiduyet,
      bangiamdoc_ngayduyet = @ngayduyet
  WHERE id = @id
END
