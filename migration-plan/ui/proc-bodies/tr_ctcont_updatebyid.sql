-- PARAMS:
-- @id int
-- @cont_id uniqueidentifier
-- @order_id int
-- @madonhang nvarchar
-- @makhachhang nvarchar
-- @masp nvarchar
-- @masp2 nvarchar
-- @macont nvarchar
-- @mausac nvarchar
-- @soluong int
-- @dvt nvarchar
-- @ghichu nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime
-- @ProformaInvoice uniqueidentifier
-- @ProformaInvoiceDetail uniqueidentifier

CREATE   PROCEDURE TR_CTCONT_UPDATEBYID
(
	@id int,	@cont_id uniqueidentifier,	@order_id int,	@madonhang nvarchar(255),	@makhachhang nvarchar(255),	@masp nvarchar(MAX),	@masp2 nvarchar(MAX),	@macont nvarchar(50),	@mausac nvarchar(MAX),	@soluong int,	@dvt nvarchar(50),	@ghichu nvarchar(MAX),	@nguoitao nvarchar(50),	@ngaytao datetime,	@nguoisua nvarchar(50),	@ngaysua datetime,	@ProformaInvoice uniqueidentifier = NULL,	@ProformaInvoiceDetail uniqueidentifier = NULL
)
AS
BEGIN
UPDATE tr_ctcont
SET	cont_id = @cont_id,	order_id = @order_id,	madonhang = @madonhang,	makhachhang = @makhachhang,	masp = @masp,	masp2 = @masp2,	macont = @macont,	mausac = @mausac,	soluong = @soluong,	dvt = @dvt,	ghichu = @ghichu,	nguoisua = @nguoisua,	ngaysua = @ngaysua,	ProformaInvoice = @ProformaInvoice,	ProformaInvoiceDetail = @ProformaInvoiceDetail
WHERE id = @id
END

