-- PARAMS:
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

CREATE PROC [dbo].[TR_BANVE_INSERT3]
(
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
INSERT INTO tr_banve
(
	masp,
	tensp,
	khachhang,
	hehang,
	filepath,
	seq1,
	seq2,
	banve_donggoi,
	banve_govan,
	phanloai,
	create_by,
	create_date,
	update_by,
	update_date,
	active
)
VALUES
(
	@masp,
	@tensp,
	@khachhang,
	@hehang,
	@filepath,
	@seq1,
	@seq2,
	@banve_donggoi,
	@banve_govan,
	@phanloai,
	@create_by,
	@create_date,
	@update_by,
	@update_date,
	@active
)

/*** ĐÁNH DẤU SẢN PHẨM ĐÃ CÓ BẢN VẼ HAY CHƯA ***/
IF @phanloai = N'Bản vẽ kỹ thuật'
BEGIN
  UPDATE tr_sanpham
  SET IsBVKT = 1
  WHERE masp = @masp
END
ELSE IF @phanloai = N'Bản vẽ đóng gói'
BEGIN
  UPDATE tr_sanpham
  SET IsBVDG = 1
  WHERE masp = @masp
END
ELSE IF @phanloai = N'Bản vẽ AI'
BEGIN
  UPDATE tr_sanpham
  SET IsBVAI = 1
  WHERE masp = @masp
END
