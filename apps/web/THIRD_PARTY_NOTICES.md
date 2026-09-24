# Background removal

Capsule runs the following software and model in a browser worker after the user selects Remove background. Model files are downloaded directly from Hugging Face and cached by the browser; garment photos stay on the device during this operation.

- [Transformers.js](https://github.com/huggingface/transformers.js), version 4.2.0: Apache License 2.0. Copyright Hugging Face. [License](https://github.com/huggingface/transformers.js/blob/main/LICENSE).
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), used by Transformers.js: MIT License. Copyright Microsoft Corporation. [License](https://github.com/microsoft/onnxruntime/blob/main/LICENSE).
- [BiRefNet Lite 512 ONNX](https://huggingface.co/studioludens/birefnet-lite-512): MIT License according to the model card. Capsule pins revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7`. This conversion is based on [ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite), also published under MIT, and [BiRefNet](https://github.com/ZhengPeng7/BiRefNet).

BiRefNet code is Copyright (c) 2024 ZhengPeng and distributed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
