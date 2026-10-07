package com.mangabridge.bootstrap.page;

import static org.assertj.core.api.Assertions.*;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class PageBodyLimitTest {
    @Test void oversizedContentLengthIsRejectedBeforeOpeningStream() {
        var reads=new AtomicInteger();var request=new MockHttpServletRequest(){
            @Override public long getContentLengthLong(){return PageService.MAX_BYTES+1L;}
            @Override public ServletInputStream getInputStream(){reads.incrementAndGet();throw new AssertionError("Body must not be opened");}
        };request.setContentType("image/png");assertInvalid(()->PageController.readBounded(request));assertThat(reads).hasValue(0);
    }
    @Test void unknownLengthChunkedUploadReadsAtMostLimitPlusOneRatherThanWholeBody() {
        var read=new AtomicInteger();var request=new MockHttpServletRequest(){
            @Override public long getContentLengthLong(){return -1;}
            @Override public ServletInputStream getInputStream(){return new ServletInputStream(){
                @Override public int read(){read.incrementAndGet();return 1;}
                @Override public int read(byte[] bytes,int offset,int length){read.addAndGet(length);java.util.Arrays.fill(bytes,offset,offset+length,(byte)1);return length;}
                @Override public boolean isFinished(){return false;}
                @Override public boolean isReady(){return true;}
                @Override public void setReadListener(ReadListener listener){}
            };}
        };request.setContentType("image/png");assertInvalid(()->PageController.readBounded(request));assertThat(read).hasValue(PageService.MAX_BYTES+1);
    }
    @Test void magicValidationAndImageToStringDoNotExposeBytes() {
        assertInvalid(()->PageService.validateImage("image/png",new byte[7]));assertInvalid(()->PageService.validateImage("image/jpeg",new byte[2]));assertInvalid(()->PageService.validateImage("image/webp",new byte[11]));
        assertThat(new PageModels.Image("image/png",new byte[]{1,2,3}).toString()).isEqualTo("Image[redacted]");
    }
    private void assertInvalid(org.assertj.core.api.ThrowableAssert.ThrowingCallable call){assertThatThrownBy(call).isInstanceOfSatisfying(PageFailure.class,e->{assertThat(e.status).isEqualTo(400);assertThat(e.code).isEqualTo("INVALID_REQUEST");});}
}
