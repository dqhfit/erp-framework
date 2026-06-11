-- PARAMS:
-- @mavt nvarchar
-- @xacnhan bit
-- @nguoixacnhan nvarchar
-- @ngayxacnhan datetime

create PROC [dbo].[TR_MATERIAL_UPDATE3]
(
	
	@mavt nvarchar(200),
	@xacnhan bit = 0,
	@nguoixacnhan nvarchar(50)='',
	@ngayxacnhan datetime = null
)
AS
UPDATE tr_material
SET
	xacnhan = @xacnhan,
	nguoixacnhan = @nguoixacnhan,
	ngayxacnhan = @ngayxacnhan
WHERE mavt = @mavt


