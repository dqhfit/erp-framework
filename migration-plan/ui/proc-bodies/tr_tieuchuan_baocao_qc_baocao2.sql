-- PARAMS:
-- @TUNGAY date
-- @DENNGAY date


CREATE   PROCEDURE [dbo].[TR_TIEUCHUAN_BAOCAO_QC_BAOCAO2]
(
	@TUNGAY DATE,
	@DENNGAY DATE
)
AS
BEGIN

	--DECLARE @TUNGAY DATE = '2025-12-01'
	--DECLARE @DENNGAY DATE = '2025-12-06'
	SELECT B.Id, B.DanhMucLoi, A.TenLoi, B.tieuchuan
	INTO #DANHMUCLOI
	FROM tr_tieuchuan_loi A
	INNER JOIN tr_tieuchuan_loi_detail B ON A.Id = B.DanhMucLoi

	SELECT DATEPART(WEEK, A.NgayLap) AS sotuan,
		B.BaoCaoQC, A.TbMLocation, A.Dondathang,
		CD.tieuchuan AS tieuchuan_chatluong_id,
		TC.tieuchuan, TC.tieuchi,
		B.pallet_id, PL.masp, PL.mact, PL.tenct,
		B.soluongdat, B.soluongloi, b.soluongChiTietloi, B.soluongkiem, B.tileloi, B.ketqua,
		HL.[name] AS loailoi, HL.ma AS maloailoi, B.tinhtrang,
		PL.soluong_can, B.TieuChuanLoi,
		TC.stt
	INTO #BAOCAO
	FROM tr_tieuchuan_baocao_qc A
	INNER JOIN tr_tieuchuan_chatluong B ON A.Id = B.BaoCaoQC
	INNER JOIN tr_tieuchuan_congdoan CD ON B.tieuchuancongdoan = CD.Id
	INNER JOIN tr_tieuchuan TC ON CD.tieuchuan = TC.Id
	LEFT JOIN tr_tieuchuan_hangloi_loai HL ON B.loailoi = HL.ma
	LEFT JOIN tr_pallet PL ON B.pallet_id = PL.id
	WHERE CAST(A.NgayLap AS date) BETWEEN @TUNGAY AND @DENNGAY

	SELECT A.sotuan, A.BaoCaoQC, A.TbMLocation, A.Dondathang,
		A.tieuchuan_chatluong_id, 
		A.tieuchuan, 
		A.tieuchi,
		CASE 
			WHEN A.tieuchi = N'Kỹ thuật' THEN 'KYTHUAT'
			WHEN A.tieuchi = N'Ngoại quan' THEN 'NGOAIQUAN'
		END AS tieuchi_id,
		A.pallet_id, A.mact, A.tenct,
		A.soluongdat, A.soluongloi, A.soluongChiTietloi, A.soluongkiem, A.tileloi, A.ketqua,
		A.TieuChuanLoi, A.maloailoi, A.loailoi, B.TenLoi, A.tinhtrang, A.soluong_can,
		A.stt
	INTO #BAOCAO_CHATLUONG
	FROM #BAOCAO A
		LEFT JOIN #DANHMUCLOI B ON A.TieuChuanLoi = B.Id
	WHERE A.tieuchi IN (N'Kỹ thuật', N'Ngoại quan')

	SELECT A.sotuan, A.TbMLocation, A.n_location, 
		Dondathang = STRING_AGG(A.Dondathang, '; '),
		TenLoi = STRING_AGG(A.TenLoi, ';'),
		tyleloi_ct = SUM(((soluongloi_NQ + soluongloi_KT) / soluongkiem)) * 100,
		tyleloi_nq = SUM((soluongloi_NQ / soluongkiem)) * 100,
		tyleloi_kt = SUM((soluongloi_KT / soluongkiem)) * 100,
		tyleloi_sp = SUM(((soluongChiTietloi_NQ+soluongChiTietloi_KT) / soluongkiem)) * 100
	FROM (
		SELECT A.sotuan, A.TbMLocation, A.n_location, 
			A.Dondathang,
			TenLoi = STRING_AGG(A.TenLoi, '; '), 
			SUM(A.soluongkiem) AS soluongkiem, 
			SUM(A.soluongloi_NQ) AS soluongloi_NQ, 
			SUM(A.soluongloi_KT) AS soluongloi_KT, 
			SUM(A.soluongChiTietloi_NQ) AS soluongChiTietloi_NQ, 
			SUM(A.soluongChiTietloi_KT) AS soluongChiTietloi_KT
			--tyleloi_ct = ((soluongloi_NQ + soluongloi_KT) / soluongkiem) * 100,
			--tyleloi_nq = (soluongloi_NQ / soluongkiem) * 100,
			--tyleloi_kt = (soluongloi_KT / soluongkiem) * 100,
			--tyleloi_sp = ((soluongChiTietloi_NQ+soluongChiTietloi_KT) / soluongkiem) * 100
		FROM (
			SELECT A.sotuan, A.Dondathang, A.TbMLocation, REPLACE(B.n_location, N'[Hoàn thành]', '') AS n_location, A.TenLoi, 
				soluongkiem = SUM(A.soluongkiem),

				soluongloi_NQ = SUM(CASE WHEN A.tieuchi_id = 'NGOAIQUAN' THEN A.soluongloi ELSE 0 END),
				soluongloi_KT = SUM(CASE WHEN A.tieuchi_id = 'KYTHUAT' THEN A.soluongloi ELSE 0 END),

				soluongChiTietloi_NQ = SUM(CASE WHEN A.tieuchi_id = 'NGOAIQUAN' THEN A.soluongChiTietloi ELSE 0 END),
				soluongChiTietloi_KT = SUM(CASE WHEN A.tieuchi_id = 'KYTHUAT' THEN A.soluongChiTietloi ELSE 0 END)
			
			FROM #BAOCAO_CHATLUONG A
				INNER JOIN trtb_m_location B ON A.TbMLocation = B.c_location
			--WHERE A.soluongloi > 0
			GROUP BY A.sotuan, A.Dondathang, A.TbMLocation, B.n_location, A.TenLoi
		) A
		GROUP BY A.sotuan, A.Dondathang, A.TbMLocation, A.n_location
	) A
	GROUP BY A.sotuan, A.TbMLocation, A.n_location

	DROP TABLE #DANHMUCLOI, #BAOCAO, #BAOCAO_CHATLUONG;
END

