-- PARAMS:
-- @id int
-- @soluong decimal
-- @ghichu nvarchar
-- @ngaysua datetime
-- @nguoisua nvarchar

CREATE   PROCEDURE [dbo].[TR_CTPHIEUXUAT_UPDATE3]
(
	@id int,	@soluong decimal(18, 3),	@ghichu nvarchar(MAX),	@ngaysua datetime,	@nguoisua nvarchar(50))	
AS
UPDATE tr_ctphieuxuat
SET	soluong = @soluong,	ghichu = @ghichu,	nguoisua = @nguoisua,
	ngaysua = @ngaysua
WHERE id = @id

