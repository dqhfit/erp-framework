-- PARAMS:
-- @id int
-- @masp nvarchar
-- @tensp nvarchar
-- @khachhang nvarchar
-- @hehang nvarchar
-- @filepath nvarchar
-- @seq1 nvarchar
-- @seq2 nvarchar
-- @banve_donggoi bit
-- @banve_govan bit
-- @phanloai nvarchar
-- @create_by nvarchar
-- @create_date datetime
-- @update_by nvarchar
-- @update_date datetime
-- @active bit

CREATE PROC [dbo].[TR_BANVE_UPDATE3]
(
	@id int,
	@masp nvarchar(MAX),
	@tensp nvarchar(MAX),
	@khachhang nvarchar(MAX),
	@hehang nvarchar(MAX),
	@filepath nvarchar(MAX),
	@seq1 nvarchar(MAX),
	@seq2 nvarchar(MAX),
	@banve_donggoi bit,
	@banve_govan bit,
	@phanloai nvarchar(MAX),
	@create_by nvarchar(50),
	@create_date datetime,
	@update_by nvarchar(50),
	@update_date datetime,
	@active bit
)
AS
UPDATE tr_banve
SET
	masp = @masp,
	tensp = @tensp,
	khachhang = @khachhang,
	hehang = @hehang,
	filepath = @filepath,
	seq1 = @seq1,
	seq2 = @seq2,
	banve_donggoi = @banve_donggoi,
	banve_govan = @banve_govan,
	phanloai = @phanloai,
	update_by = @update_by,
	update_date = @update_date,
	active = @active
WHERE id = @id
