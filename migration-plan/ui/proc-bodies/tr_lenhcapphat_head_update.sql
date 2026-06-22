-- PARAMS:
-- @LenhCapPhatID nvarchar
-- @LoaiDonHang nvarchar
-- @LoaiCapPhat nvarchar
-- @MaDonDatHang nvarchar
-- @hoanthanh bit
-- @vuotdinhmuc bit
-- @active bit
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoiduyet nvarchar
-- @ngayduyet datetime
-- @mahoso nvarchar

CREATE PROC [dbo].[TR_LENHCAPPHAT_HEAD_UPDATE]
(
	@LenhCapPhatID nvarchar(50),
	@LoaiDonHang nvarchar(50),
	@LoaiCapPhat nvarchar(50),
	@MaDonDatHang nvarchar(200),
	@hoanthanh bit,
	@vuotdinhmuc bit,
	@active bit,
	@nguoitao nvarchar(50),
	@ngaytao datetime,
  @nguoiduyet nvarchar(50) = null,
  @ngayduyet datetime = null,
  @mahoso nvarchar(50) = null
)
AS
UPDATE tr_lenhcapphat_head
SET 
	LoaiDonHang = @LoaiDonHang,
	LoaiCapPhat = @LoaiCapPhat,
	MaDonDatHang = @MaDonDatHang,
	hoanthanh = @hoanthanh,
	vuotdinhmuc = @vuotdinhmuc,
	active = @active,
  nguoiduyet = @nguoiduyet,
  ngayduyet = @ngayduyet,
  mahoso = @mahoso
WHERE LenhCapPhatID = @LenhCapPhatID
