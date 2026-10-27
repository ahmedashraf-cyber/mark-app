//! video_range.rs — which bytes of a video file does one Range request get?
//!
//! Pure (no I/O) so it can be unit-tested; used by the chunked path of the local video server (Tag mode).
//!
//! Why a cap exists: a <video> element asks for `bytes=N-`, i.e. "from N to the end of the file". The original
//! handler honoured that literally, reading the whole remainder (up to ~800 MB) into memory before sending a byte.
//! A trace of real seeks showed 37 of 40 requests doing exactly that (median 782 MB, ~300 ms each, 99% of it the
//! read). HTTP allows a server to answer a range request with LESS than was asked, as long as Content-Range says what
//! it sent; the browser simply asks for the next piece when it needs it. So each response is capped at CHUNK_BYTES.

use http_range::HttpRange;

/// The most one response carries. 4 MiB is about 3 s of this footage, and a warm read of it takes a few ms.
pub const CHUNK_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum RangePlan {
    /// Send `length` bytes starting at `start` (206 Partial Content).
    Serve { start: u64, length: u64 },
    /// Nothing can be served for this request (416 Range Not Satisfiable). Includes a request that starts exactly at
    /// end-of-file, which the old handler answered with the WHOLE file.
    Unsatisfiable,
}

/// `range_header` is the raw `Range` header value, if any. `size` is the file size.
pub fn plan(range_header: Option<&str>, size: u64, chunk: u64) -> RangePlan {
    if size == 0 {
        return RangePlan::Unsatisfiable;
    }
    match range_header {
        // No Range header: answer with the first chunk and a Content-Range carrying the total size, which is what the
        // original handler's "206 so WebView2 learns the size from the first response" comment was after.
        None => RangePlan::Serve { start: 0, length: chunk.min(size) },
        Some(h) => match HttpRange::parse(h, size) {
            // Several ranges in one request: like the original, serve the first only.
            Ok(ranges) if !ranges.is_empty() && ranges[0].length > 0 => {
                let r = &ranges[0];
                RangePlan::Serve { start: r.start, length: r.length.min(chunk) }
            }
            _ => RangePlan::Unsatisfiable,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SIZE: u64 = 781_854_480; // a real file size from the trace
    const C: u64 = CHUNK_BYTES;

    #[test]
    fn no_range_header_gives_the_first_chunk_and_the_total_size_comes_from_content_range() {
        assert_eq!(plan(None, SIZE, C), RangePlan::Serve { start: 0, length: C });
    }
    #[test]
    fn a_small_file_is_served_whole_in_one_piece() {
        assert_eq!(plan(None, 1000, C), RangePlan::Serve { start: 0, length: 1000 });
    }
    #[test]
    fn the_316_byte_request_from_the_trace_is_unchanged() {
        assert_eq!(plan(Some("bytes=0-315"), SIZE, C), RangePlan::Serve { start: 0, length: 316 });
    }
    #[test]
    fn an_open_ended_range_is_capped_instead_of_reading_the_rest_of_the_file() {
        // the real request that made the server read 807,968,153 bytes
        assert_eq!(plan(Some("bytes=6356992-"), SIZE, C), RangePlan::Serve { start: 6_356_992, length: C });
    }
    #[test]
    fn a_range_near_the_end_is_not_padded_past_eof() {
        // the real ~2 MB tail request the player makes on every load
        assert_eq!(plan(Some("bytes=779812864-"), SIZE, C), RangePlan::Serve { start: 779_812_864, length: 2_041_616 });
    }
    #[test]
    fn a_request_starting_exactly_at_end_of_file_is_not_satisfiable_not_the_whole_file() {
        // the real request seen 13 times, each answered with 782 MB by the old handler
        assert_eq!(plan(Some("bytes=781854480-"), SIZE, C), RangePlan::Unsatisfiable);
    }
    #[test]
    fn the_last_byte_can_be_asked_for() {
        assert_eq!(plan(Some("bytes=781854479-781854479"), SIZE, C), RangePlan::Serve { start: SIZE - 1, length: 1 });
    }
    #[test]
    fn a_bounded_range_longer_than_the_cap_is_capped_too() {
        assert_eq!(plan(Some("bytes=0-99999999"), SIZE, C), RangePlan::Serve { start: 0, length: C });
    }
    #[test]
    fn a_suffix_range_serves_the_end_of_the_file() {
        assert_eq!(plan(Some("bytes=-1000"), SIZE, C), RangePlan::Serve { start: SIZE - 1000, length: 1000 });
    }
    #[test]
    fn a_range_past_the_end_reversed_or_garbage_is_unsatisfiable() {
        for h in ["bytes=781854490-", "bytes=10-5", "garbage", "bytes=", "", "items=0-5"] {
            assert_eq!(plan(Some(h), SIZE, C), RangePlan::Unsatisfiable, "{:?}", h);
        }
    }
    #[test]
    fn an_empty_file_has_nothing_to_serve() {
        assert_eq!(plan(None, 0, C), RangePlan::Unsatisfiable);
        assert_eq!(plan(Some("bytes=0-"), 0, C), RangePlan::Unsatisfiable);
    }
    #[test]
    fn several_ranges_in_one_request_serve_the_first_like_the_original() {
        assert_eq!(plan(Some("bytes=0-99,200-299"), SIZE, C), RangePlan::Serve { start: 0, length: 100 });
    }
    #[test]
    fn nothing_is_ever_served_beyond_the_cap_or_the_file() {
        for (h, _) in [("bytes=0-", 0), ("bytes=123456-", 0), ("bytes=-5000000", 0), ("bytes=700000000-900000000", 0)] {
            if let RangePlan::Serve { start, length } = plan(Some(h), SIZE, C) {
                assert!(length <= C && length > 0 && start + length <= SIZE, "{:?} -> {} + {}", h, start, length);
            }
        }
    }
}
